import 'dotenv/config';

import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

import { pool, initializeDatabase } from './db.js';

const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );
  res.header(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, OPTIONS'
  );

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

const port = process.env.PORT || 3000;

const secret =
  process.env.JWT_SECRET || 'development-only-change-me';

app.use(express.json({ limit: '8mb' }));

app.use(express.static('public'));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

const tokenFor = u =>
  jwt.sign(
    {
      id: u.id,
      name: u.name,
      role: u.role
    },
    secret,
    {
      expiresIn: '7d'
    }
  );

function optionalAuth(req, _res, next) {
  const token =
    req.headers.authorization?.split(' ')[1];

  if (token) {
    try {
      req.user = jwt.verify(token, secret);
    } catch {
      // Ignore invalid optional tokens.
    }
  }

  next();
}

function requireAuth(req, res, next) {
  optionalAuth(req, res, () => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Please sign in first.'
      });
    }

    next();
  });
}

function adminOnly(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Only editors can publish news.'
      });
    }

    next();
  });
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    mobile: user.mobile || null,
    role: user.role,
  };
}

function finishLogin(res, user, status = 200) {
  return res.status(status).json({
    user: publicUser(user),
    token: tokenFor(user)
  });
}

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password, confirmPassword } = req.body;
    const cleanName = String(name || '').trim();
    const emailAddress = String(email || '').trim().toLowerCase();

    if (!cleanName || !emailAddress || !password || !confirmPassword) {
      return res.status(400).json({ error: 'Name, email, and both password fields are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }
    const { rows: [existing] } = await pool.query(
      'SELECT id FROM users WHERE lower(email) = $1', [emailAddress]
    );
    if (existing) return res.status(409).json({ error: 'That email is already registered. Please log in.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const { rows: [user] } = await pool.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, mobile, role, profile_photo`,
      [cleanName, emailAddress, passwordHash]
    );
    return finishLogin(res, user, 201);
  } catch (error) {
    console.error('Signup error:', error);
    if (String(error?.message || '').toLowerCase().includes('unique')) {
      return res.status(409).json({ error: 'That email is already registered. Please log in.' });
    }
    return res.status(500).json({ error: 'We could not create your account. Please try again.' });
  }
});

/*
 * LOGIN
 */
app.post('/api/auth/login', async (req, res) => {
  try {
    const {
      email,
      password
    } = req.body;

    const emailAddress = String(email || '').trim().toLowerCase();
    if (!emailAddress || !password) {
      return res.status(400).json({ error: 'Enter your email and password.' });
    }

    const {
      rows: [u]
    } = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [emailAddress]
    );

    if (
      !u ||
      !(await bcrypt.compare(
        password || '',
        u.password_hash
      ))
    ) {
      return res.status(401).json({
        error:
          'Incorrect email or password.'
      });
    }

    finishLogin(res, u);
  } catch (error) {
    console.error(
      'Login error:',
      error
    );

    res.status(500).json({
      error: 'Unable to log in.'
    });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const { rows: [user] } = await pool.query(
      'SELECT id, name, email, mobile, role, profile_photo FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!user) return res.status(401).json({ error: 'Please sign in again.' });
    res.json({ user: publicUser(user) });
  } catch (error) {
    console.error('Session lookup error:', error);
    res.status(500).json({ error: 'Unable to restore your session.' });
  }
});

/*
 * ARTICLES
 */
app.get(
  '/api/articles',
  requireAuth,
  async (req, res) => {
    const { rows } =
      await pool.query(
        `SELECT
          a.*,
          u.name author,
          (
            SELECT COUNT(*)
            FROM likes
            WHERE article_id = a.id
          ) likes,
          (
            SELECT COUNT(*)
            FROM comments
            WHERE article_id = a.id
          ) comments,
          EXISTS(
            SELECT 1
            FROM likes
            WHERE article_id = a.id
              AND user_id = $1
          ) liked
        FROM articles a
        JOIN users u
          ON u.id = a.author_id
        ORDER BY
          a.is_breaking DESC,
          a.published_at DESC`,
        [req.user?.id || 0]
      );

    res.json(rows);
  }
);

/*
 * MEMBERS
 */
app.get(
  '/api/members',
  async (_req, res) => {
    const { rows } =
      await pool.query(
        `SELECT
          id,
          name,
          photo_url,
          note,
          created_at
         FROM members
         ORDER BY created_at DESC`
      );

    res.json(rows);
  }
);

app.post(
  '/api/members',
  adminOnly,
  async (req, res) => {
    const {
      name,
      photoUrl,
      note
    } = req.body;

    if (
      !name?.trim() ||
      !note?.trim()
    ) {
      return res.status(400).json({
        error:
          'Member name and note are required.'
      });
    }

    const {
      rows: [member]
    } = await pool.query(
      `INSERT INTO members
       (name, photo_url, note)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [
        name.trim(),
        photoUrl || null,
        note.trim()
      ]
    );

    res.status(201).json(member);
  }
);

/*
 * HELPLINE
 */
app.post(
  '/api/help-requests',
  async (req, res) => {
    const {
      name,
      work,
      mobile
    } = req.body;

    if (
      !name?.trim() ||
      !work?.trim() ||
      !mobile?.trim()
    ) {
      return res.status(400).json({
        error:
          'Name, work, and mobile number are required.'
      });
    }

    const {
      rows: [request]
    } = await pool.query(
      `INSERT INTO help_requests
       (name, work, mobile)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [
        name.trim(),
        work.trim(),
        mobile.trim()
      ]
    );

    res.status(201).json(request);
  }
);

/*
 * CREATE ARTICLE
 */
app.post(
  '/api/articles',
  requireAuth,
  async (req, res) => {
    const {
      title,
      excerpt,
      body,
      category,
      imageUrl,
      isBreaking
    } = req.body;

    if (!title || !excerpt) {
      return res.status(400).json({
        error:
          'A headline and summary are required.'
      });
    }

    const {
      rows: [article]
    } = await pool.query(
      `INSERT INTO articles
       (
         title,
         excerpt,
         body,
         category,
         image_url,
         is_breaking,
         author_id
       )
       VALUES
       ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        title,
        excerpt,
        body || excerpt,
        category || 'General',
        imageUrl || null,
        req.user.role === 'admin' && isBreaking ? 1 : 0,
        req.user.id
      ]
    );

    res.status(201).json(article);
  }
);

/*
 * ADMIN USERS
 */
app.get(
  '/api/admin/users',
  adminOnly,
  async (_req, res) => {
    const { rows } =
      await pool.query(
        `SELECT
          id,
          name,
          email,
          mobile,
          mobile_verified,
          role,
          created_at
         FROM users
         ORDER BY created_at DESC`
      );

    res.json(rows);
  }
);

/*
 * EDIT ARTICLE
 */
app.put(
  '/api/articles/:id',
  adminOnly,
  async (req, res) => {
    const {
      title,
      excerpt,
      body,
      category,
      imageUrl,
      isBreaking
    } = req.body;

    if (!title || !excerpt) {
      return res.status(400).json({
        error:
          'A headline and summary are required.'
      });
    }

    const {
      rows: [article]
    } = await pool.query(
      `UPDATE articles
       SET
         title = $1,
         excerpt = $2,
         body = $3,
         category = $4,
         image_url = COALESCE($5, image_url),
         is_breaking = $6
       WHERE id = $7
       RETURNING *`,
      [
        title,
        excerpt,
        body || excerpt,
        category || 'General',
        imageUrl || null,
        isBreaking ? 1 : 0,
        +req.params.id
      ]
    );

    if (!article) {
      return res.status(404).json({
        error: 'Story not found.'
      });
    }

    res.json(article);
  }
);

/*
 * DELETE ARTICLE
 */
app.delete(
  '/api/articles/:id',
  adminOnly,
  async (req, res) => {
    const result =
      await pool.query(
        `DELETE FROM articles
         WHERE id = $1
         RETURNING id`,
        [+req.params.id]
      );

    if (!result.rowCount) {
      return res.status(404).json({
        error: 'Story not found.'
      });
    }

    res.json({
      ok: true
    });
  }
);

/*
 * LIKE
 */
app.post(
  '/api/articles/:id/like',
  requireAuth,
  async (req, res) => {
    const id =
      +req.params.id;

    const found =
      await pool.query(
        `SELECT 1
         FROM likes
         WHERE user_id = $1
           AND article_id = $2`,
        [
          req.user.id,
          id
        ]
      );

    if (found.rowCount) {
      await pool.query(
        `DELETE FROM likes
         WHERE user_id = $1
           AND article_id = $2`,
        [
          req.user.id,
          id
        ]
      );
    } else {
      await pool.query(
        `INSERT INTO likes
         (user_id, article_id)
         VALUES ($1, $2)`,
        [
          req.user.id,
          id
        ]
      );
    }

    res.json({
      ok: true
    });
  }
);

/*
 * COMMENTS
 */
app.get(
  '/api/articles/:id/comments',
  requireAuth,
  async (req, res) => {
    const { rows } =
      await pool.query(
        `SELECT
          c.*,
          u.name
         FROM comments c
         JOIN users u
           ON u.id = c.user_id
         WHERE article_id = $1
         ORDER BY c.created_at ASC`,
        [req.params.id]
      );

    res.json(rows);
  }
);

app.post(
  '/api/articles/:id/comments',
  requireAuth,
  async (req, res) => {
    if (
      !req.body.content?.trim()
    ) {
      return res.status(400).json({
        error:
          'Write a comment first.'
      });
    }

    const {
      rows: [comment]
    } = await pool.query(
      `INSERT INTO comments
       (article_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [
        req.params.id,
        req.user.id,
        req.body.content.trim()
      ]
    );

    res.status(201).json(comment);
  }
);

/*
 * TOURNAMENTS
 *
 * Tournament management is admin-only for writes.
 * Public users can view tournaments and live streams.
 */
app.get('/api/tournaments', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *
       FROM tournaments
       ORDER BY
         live_status DESC,
         start_date ASC,
         created_at DESC`
    );

    for (const tournament of rows) {
      const matches =
        await pool.query(
          `SELECT *
           FROM tournament_matches
           WHERE tournament_id = $1
           ORDER BY
             match_date ASC,
             created_at ASC`,
          [tournament.id]
        );

      tournament.matches =
        matches.rows;
    }

    res.json(rows);
  } catch (error) {
    console.error('Tournament list error:', error);
    res.status(500).json({
      error: 'Unable to load tournaments.'
    });
  }
});

// Compact shape used by the public live centre.
app.get('/api/tournaments/current', async (_req, res) => {
  try {
    const { rows: [match] } = await pool.query(
      `SELECT m.*, t.name AS tournament_name, t.live_url AS tournament_live_url
       FROM tournament_matches m
       JOIN tournaments t ON t.id = m.tournament_id
       WHERE lower(m.status) = 'live'
       ORDER BY m.created_at DESC
       LIMIT 1`
    );
    const { rows } = await pool.query(
      `SELECT m.*, t.name AS tournament_name
       FROM tournament_matches m
       JOIN tournaments t ON t.id = m.tournament_id
       WHERE lower(m.status) = 'upcoming'
       ORDER BY m.match_date ASC, m.created_at ASC`
    );
    res.json({
      live: match ? {
        ...match,
        stream_url: match.live_url || match.tournament_live_url || '',
        score_a: match.score_a || '0/0',
        score_b: match.score_b || '0/0'
      } : null,
      upcoming: rows
    });
  } catch (error) {
    console.error('Current tournament error:', error);
    res.status(500).json({ error: 'Unable to load current tournament.' });
  }
});

app.post('/api/tournaments', adminOnly, async (req, res) => {
  try {
    const {
      name,
      description,
      venue,
      startDate,
      endDate,
      liveUrl,
      liveStatus
    } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({
        error: 'Tournament name is required.'
      });
    }

    const {
      rows: [tournament]
    } = await pool.query(
      `INSERT INTO tournaments
       (
         name,
         description,
         venue,
         start_date,
         end_date,
         live_url,
         live_status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        name.trim(),
        description?.trim() || null,
        venue?.trim() || null,
        startDate || null,
        endDate || null,
        liveUrl?.trim() || null,
        liveStatus ? 1 : 0
      ]
    );

    res.status(201).json(tournament);
  } catch (error) {
    console.error('Tournament create error:', error);
    res.status(500).json({
      error: 'Unable to create tournament.'
    });
  }
});

app.put('/api/tournaments/:id', adminOnly, async (req, res) => {
  try {
    const {
      name,
      description,
      venue,
      startDate,
      endDate,
      liveUrl,
      liveStatus
    } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({
        error: 'Tournament name is required.'
      });
    }

    const {
      rows: [tournament]
    } = await pool.query(
      `UPDATE tournaments
       SET
         name = $1,
         description = $2,
         venue = $3,
         start_date = $4,
         end_date = $5,
         live_url = $6,
         live_status = $7,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $8
       RETURNING *`,
      [
        name.trim(),
        description?.trim() || null,
        venue?.trim() || null,
        startDate || null,
        endDate || null,
        liveUrl?.trim() || null,
        liveStatus ? 1 : 0,
        +req.params.id
      ]
    );

    if (!tournament) {
      return res.status(404).json({
        error: 'Tournament not found.'
      });
    }

    res.json(tournament);
  } catch (error) {
    console.error('Tournament update error:', error);
    res.status(500).json({
      error: 'Unable to update tournament.'
    });
  }
});

app.delete('/api/tournaments/:id', adminOnly, async (req, res) => {
  try {
    const result =
      await pool.query(
        `DELETE FROM tournaments
         WHERE id = $1
         RETURNING id`,
        [+req.params.id]
      );

    if (!result.rowCount) {
      return res.status(404).json({
        error: 'Tournament not found.'
      });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Tournament delete error:', error);
    res.status(500).json({
      error: 'Unable to delete tournament.'
    });
  }
});

app.post('/api/tournaments/:id/matches', adminOnly, async (req, res) => {
  try {
    const {
      teamA,
      teamB,
      matchDate,
      venue,
      scoreA,
      scoreB,
      status,
      liveUrl
    } = req.body;

    if (!teamA?.trim() || !teamB?.trim()) {
      return res.status(400).json({
        error: 'Both team names are required.'
      });
    }

    const tournament =
      await pool.query(
        `SELECT id FROM tournaments WHERE id = $1`,
        [+req.params.id]
      );

    if (!tournament.rows.length) {
      return res.status(404).json({
        error: 'Tournament not found.'
      });
    }

    const {
      rows: [match]
    } = await pool.query(
      `INSERT INTO tournament_matches
       (
         tournament_id,
         team_a,
         team_b,
         match_date,
         venue,
         score_a,
         score_b,
         status,
         live_url
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        +req.params.id,
        teamA.trim(),
        teamB.trim(),
        matchDate || null,
        venue?.trim() || null,
        scoreA?.trim() || '',
        scoreB?.trim() || '',
        status?.trim() || 'Upcoming',
        liveUrl?.trim() || null
      ]
    );

    res.status(201).json(match);
  } catch (error) {
    console.error('Match create error:', error);
    res.status(500).json({
      error: 'Unable to add match.'
    });
  }
});

app.put('/api/tournament-matches/:id', adminOnly, async (req, res) => {
  try {
    const {
      teamA,
      teamB,
      matchDate,
      venue,
      scoreA,
      scoreB,
      status,
      liveUrl
    } = req.body;

    if (!teamA?.trim() || !teamB?.trim()) {
      return res.status(400).json({
        error: 'Both team names are required.'
      });
    }

    const {
      rows: [match]
    } = await pool.query(
      `UPDATE tournament_matches
       SET
         team_a = $1,
         team_b = $2,
         match_date = $3,
         venue = $4,
         score_a = $5,
         score_b = $6,
         status = $7,
         live_url = $8
       WHERE id = $9
       RETURNING *`,
      [
        teamA.trim(),
        teamB.trim(),
        matchDate || null,
        venue?.trim() || null,
        scoreA?.trim() || '',
        scoreB?.trim() || '',
        status?.trim() || 'Upcoming',
        liveUrl?.trim() || null,
        +req.params.id
      ]
    );

    if (!match) {
      return res.status(404).json({
        error: 'Match not found.'
      });
    }

    res.json(match);
  } catch (error) {
    console.error('Match update error:', error);
    res.status(500).json({
      error: 'Unable to update match.'
    });
  }
});

app.delete('/api/tournament-matches/:id', adminOnly, async (req, res) => {
  try {
    const result =
      await pool.query(
        `DELETE FROM tournament_matches
         WHERE id = $1
         RETURNING id`,
        [+req.params.id]
      );

    if (!result.rowCount) {
      return res.status(404).json({
        error: 'Match not found.'
      });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Match delete error:', error);
    res.status(500).json({
      error: 'Unable to delete match.'
    });
  }
});

/*
 * START SERVER
 */
initializeDatabase()
  .then(() => {
    app.listen(
      port,
      () =>
        console.log(
          `Donepudi running at http://localhost:${port}`
        )
    );
  })
  .catch(error => {
    console.error(
      'Database setup failed:',
      error.message
    );

    process.exit(1);
  });
