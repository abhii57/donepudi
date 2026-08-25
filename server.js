import 'dotenv/config';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { pool, initializeDatabase } from './db.js';

const app = express();
const port = process.env.PORT || 3000;
const secret = process.env.JWT_SECRET || 'development-only-change-me';
app.use(express.json()); app.use(express.static('public'));
const tokenFor = u => jwt.sign({ id: u.id, name: u.name, role: u.role }, secret, { expiresIn: '7d' });
function optionalAuth(req, _res, next) { const t = req.headers.authorization?.split(' ')[1]; if (t) try { req.user = jwt.verify(t, secret); } catch {} next(); }
function requireAuth(req, res, next) { optionalAuth(req,res,()=> req.user ? next() : res.status(401).json({error:'Please sign in first.'})); }
function adminOnly(req, res, next) { requireAuth(req,res,()=> req.user.role === 'admin' ? next() : res.status(403).json({error:'Only editors can publish news.'})); }

app.post('/api/auth/signup', async (req,res) => { try { const {name,email,password} = req.body; if (!name || !email || !password || password.length < 6) return res.status(400).json({error:'Use a name, valid email, and password of at least 6 characters.'}); const hash=await bcrypt.hash(password,10); const {rows:[u]}=await pool.query('INSERT INTO users (name,email,password_hash) VALUES ($1,$2,$3) RETURNING id,name,email,role',[name,email.toLowerCase(),hash]); res.status(201).json({user:u,token:tokenFor(u)}); } catch(e) { res.status(409).json({error:'That email is already registered.'}); } });
app.post('/api/auth/login', async (req,res) => { const {email,password}=req.body; const {rows:[u]}=await pool.query('SELECT * FROM users WHERE email=$1',[email?.toLowerCase()]); if(!u || !(await bcrypt.compare(password||'',u.password_hash))) return res.status(401).json({error:'Incorrect email or password.'}); res.json({user:{id:u.id,name:u.name,email:u.email,role:u.role},token:tokenFor(u)}); });
app.get('/api/articles', optionalAuth, async (req,res) => { const {rows}=await pool.query(`SELECT a.*, u.name author, (SELECT COUNT(*) FROM likes WHERE article_id=a.id) likes, (SELECT COUNT(*) FROM comments WHERE article_id=a.id) comments, EXISTS(SELECT 1 FROM likes WHERE article_id=a.id AND user_id=$1) liked FROM articles a JOIN users u ON u.id=a.author_id ORDER BY a.is_breaking DESC,a.published_at DESC`,[req.user?.id||0]); res.json(rows); });
app.post('/api/articles', adminOnly, async (req,res) => { const {title,excerpt,body,category,imageUrl,isBreaking}=req.body; if(!title||!excerpt) return res.status(400).json({error:'A headline and summary are required.'}); const {rows:[a]}=await pool.query('INSERT INTO articles (title,excerpt,body,category,image_url,is_breaking,author_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',[title,excerpt,body||excerpt,category||'General',imageUrl||null,!!isBreaking,req.user.id]); res.status(201).json(a); });
app.post('/api/articles/:id/like', requireAuth, async(req,res)=>{ const id=+req.params.id; const found=await pool.query('SELECT 1 FROM likes WHERE user_id=$1 AND article_id=$2',[req.user.id,id]); if(found.rowCount) await pool.query('DELETE FROM likes WHERE user_id=$1 AND article_id=$2',[req.user.id,id]); else await pool.query('INSERT INTO likes (user_id,article_id) VALUES ($1,$2)',[req.user.id,id]); res.json({ok:true}); });
app.get('/api/articles/:id/comments', async(req,res)=>{const {rows}=await pool.query('SELECT c.*,u.name FROM comments c JOIN users u ON u.id=c.user_id WHERE article_id=$1 ORDER BY c.created_at ASC',[req.params.id]);res.json(rows)});
app.post('/api/articles/:id/comments',requireAuth,async(req,res)=>{if(!req.body.content?.trim())return res.status(400).json({error:'Write a comment first.'});const {rows:[c]}=await pool.query('INSERT INTO comments (article_id,user_id,content) VALUES ($1,$2,$3) RETURNING *',[req.params.id,req.user.id,req.body.content.trim()]);res.status(201).json(c)});
initializeDatabase().then(()=>app.listen(port,()=>console.log(`PulseWire running at http://localhost:${port}`))).catch(e=>{console.error('Database setup failed:',e.message);process.exit(1)});
