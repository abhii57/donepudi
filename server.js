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

/*
 * NORMALIZE INDIAN MOBILE NUMBER
 *
 * 9876543210
 * 919876543210
 * +919876543210
 *
 * become:
 * 919876543210
 */
function normalizeIndianMobile(value) {
  const digits = String(value || '').replace(/\D/g, '');

  if (digits.length === 10) {
    return '91' + digits;
  }

  if (
    digits.length === 12 &&
    digits.startsWith('91')
  ) {
    return digits;
  }

  return null;
}

/*
 * CHECK SIGNUP DETAILS BEFORE SENDING OTP
 */
app.post('/api/auth/check-signup', async (req, res) => {
  try {
    const {
      name,
      email,
      mobile,
      password,
      confirmPassword
    } = req.body;

    if (
      !name?.trim() ||
      !email?.trim() ||
      !mobile?.trim() ||
      !password ||
      !confirmPassword
    ) {
      return res.status(400).json({
        error:
          'Please fill in all signup fields.'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error:
          'Password must be at least 6 characters.'
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        error: 'Passwords do not match.'
      });
    }

    const normalizedMobile =
      normalizeIndianMobile(mobile);

    if (!normalizedMobile) {
      return res.status(400).json({
        error:
          'Enter a valid Indian mobile number.'
      });
    }

    const emailAddress =
      email.trim().toLowerCase();

    const emailResult = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [emailAddress]
    );

    if (emailResult.rowCount) {
      return res.status(409).json({
        error:
          'That email is already registered.'
      });
    }

    const mobileResult = await pool.query(
      'SELECT id FROM users WHERE mobile = $1',
      ['+' + normalizedMobile]
    );

    if (mobileResult.rowCount) {
      return res.status(409).json({
        error:
          'That mobile number is already registered.'
      });
    }

    res.json({
      ok: true,
      mobile: normalizedMobile
    });
  } catch (error) {
    console.error(
      'Signup validation error:',
      error
    );

    res.status(500).json({
      error:
        'Unable to validate signup details.'
    });
  }
});

/*
 * VERIFY MSG91 OTP SERVER-SIDE
 *
 * The browser sends only reqId + OTP. The MSG91
 * Authkey remains on the server. MSG91 returns
 * the access-token (JWT) after successful OTP
 * verification.
 */
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { reqId, otp } = req.body;

    if (!reqId || !/^\d{4,8}$/.test(String(otp || ''))) {
      return res.status(400).json({
        error: 'Request ID and a valid OTP are required.'
      });
    }

    const msg91Authkey = process.env.MSG91_AUTHKEY;

    if (!msg91Authkey) {
      console.error('MSG91_AUTHKEY is missing.');
      return res.status(500).json({
        error: 'OTP service is not configured.'
      });
    }

    const verifyResponse = await fetch(
      'https://api.msg91.com/api/v5/widget/verifyOtp',
      {
        method: 'POST',
        headers: {
          authkey: msg91Authkey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          reqId: String(reqId),
          otp: String(otp)
        })
      }
    );

    const verifyData = await verifyResponse.json().catch(() => ({}));

    if (!verifyResponse.ok) {
      console.error('MSG91 OTP verification failed:', verifyData);
      return res.status(400).json({
        error: verifyData?.message || 'Invalid or expired OTP.'
      });
    }

    const accessToken =
      verifyData?.['access-token'] ||
      verifyData?.accessToken ||
      verifyData?.data?.['access-token'] ||
      verifyData?.data?.accessToken ||
      verifyData?.token ||
      '';

    if (!accessToken) {
      console.error('MSG91 verification returned no access token:', verifyData);
      return res.status(502).json({
        error: 'OTP was accepted, but MSG91 did not return a verification token.'
      });
    }

    res.json({ ok: true, accessToken });
  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({
      error: 'Unable to verify OTP right now.'
    });
  }
});

/*
 * SIGNUP
 *
 * The account is created ONLY after the
 * MSG91 access token has been verified
 * server-side.
 */
app.post('/api/auth/signup', async (req, res) => {
  try {
    const {
      name,
      email,
      mobile,
      password,
      confirmPassword,
      otpAccessToken
    } = req.body;

    if (
      !name?.trim() ||
      !email?.trim() ||
      !mobile?.trim() ||
      !password ||
      !confirmPassword
    ) {
      return res.status(400).json({
        error:
          'Name, email, mobile, and password are required.'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error:
          'Password must be at least 6 characters.'
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        error: 'Passwords do not match.'
      });
    }

    if (!otpAccessToken) {
      return res.status(400).json({
        error:
          'Please verify your mobile number first.'
      });
    }

    const normalizedMobile =
      normalizeIndianMobile(mobile);

    if (!normalizedMobile) {
      return res.status(400).json({
        error:
          'Enter a valid Indian mobile number.'
      });
    }

    const emailAddress =
      email.trim().toLowerCase();

    /*
     * MSG91 Authkey must remain on the server.
     */
    const msg91Authkey =
      process.env.MSG91_AUTHKEY;

    if (!msg91Authkey) {
      console.error(
        'MSG91_AUTHKEY is missing.'
      );

      return res.status(500).json({
        error:
          'OTP service is not configured.'
      });
    }

    /*
     * Verify the access token returned by
     * the MSG91 OTP Widget.
     *
     * MSG91 expects:
     * authkey
     * access-token
     */
    const verifyResponse = await fetch(
      'https://control.msg91.com/api/v5/widget/verifyAccessToken',
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          authkey: msg91Authkey,
          'access-token': otpAccessToken
        })
      }
    );

    const verifyData =
      await verifyResponse.json().catch(
        () => ({})
      );

    if (!verifyResponse.ok) {
      console.error(
        'MSG91 access token verification failed:',
        verifyData
      );

      return res.status(400).json({
        error:
          'Mobile verification failed. Please request a new OTP.'
      });
    }

    /*
     * Try to identify the number that MSG91
     * says was verified.
     */
    const verifiedIdentifier =
      verifyData?.data?.identifier ||
      verifyData?.data?.mobile ||
      verifyData?.identifier ||
      verifyData?.mobile ||
      '';

    if (verifiedIdentifier) {
      const verifiedMobile =
        normalizeIndianMobile(
          verifiedIdentifier
        );

      if (
        verifiedMobile &&
        verifiedMobile !== normalizedMobile
      ) {
        return res.status(400).json({
          error:
            'The verified mobile number does not match.'
        });
      }
    }

    /*
     * Check again immediately before creation.
     */
    const existingEmail =
      await pool.query(
        'SELECT id FROM users WHERE email = $1',
        [emailAddress]
      );

    if (existingEmail.rowCount) {
      return res.status(409).json({
        error:
          'That email is already registered.'
      });
    }

    const existingMobile =
      await pool.query(
        'SELECT id FROM users WHERE mobile = $1',
        ['+' + normalizedMobile]
      );

    if (existingMobile.rowCount) {
      return res.status(409).json({
        error:
          'That mobile number is already registered.'
      });
    }

    const hash =
      await bcrypt.hash(password, 10);

    const {
      rows: [u]
    } = await pool.query(
      `INSERT INTO users
       (
         name,
         email,
         mobile,
         mobile_verified,
         password_hash
       )
       VALUES ($1, $2, $3, 1, $4)
       RETURNING
         id,
         name,
         email,
         mobile,
         role`,
      [
        name.trim(),
        emailAddress,
        '+' + normalizedMobile,
        hash
      ]
    );

    res.status(201).json({
      user: u,
      token: tokenFor(u)
    });
  } catch (error) {
    console.error(
      'Signup error:',
      error
    );

    const message =
      String(error?.message || '');

    if (
      message.includes('UNIQUE') ||
      message.includes('constraint')
    ) {
      return res.status(409).json({
        error:
          'That email or mobile number is already registered.'
      });
    }

    res.status(500).json({
      error:
        'Unable to create your account.'
    });
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

    const {
      rows: [u]
    } = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email?.toLowerCase()]
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

    res.json({
      user: {
        id: u.id,
        name: u.name,
        email: u.email,
        mobile: u.mobile,
        role: u.role
      },
      token: tokenFor(u)
    });
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

/*
 * ARTICLES
 */
app.get(
  '/api/articles',
  optionalAuth,
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
        !!isBreaking,
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
        !!isBreaking,
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
        !!liveStatus
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
        !!liveStatus,
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