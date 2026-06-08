'use strict';
const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const NEXUS_NAME = process.env.NEXUS_NAME || 'Nexus';
const TABLE_NAME = process.env.TABLE_NAME || 'records';
const ENTITY_LABEL = process.env.ENTITY_LABEL || 'Record';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function initDB() {
  try {
    await pool.query('CREATE TABLE IF NOT EXISTS ' + TABLE_NAME + ' (id SERIAL PRIMARY KEY, field_1 TEXT, field_2 TEXT, field_3 TEXT, field_4 TEXT, field_5 TEXT, field_6 TEXT, status VARCHAR(50) DEFAULT \'active\', notes TEXT, igm_governed BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
    await pool.query('CREATE TABLE IF NOT EXISTS audit_log (id SERIAL PRIMARY KEY, table_name VARCHAR(100), record_id INTEGER, action_type VARCHAR(20), changed_by VARCHAR(255), changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
    await pool.query('CREATE TABLE IF NOT EXISTS contact_log (id SERIAL PRIMARY KEY, record_id INTEGER, contact_type VARCHAR(100), notes TEXT, author VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
    console.log('[IGM] Database initialized: ' + NEXUS_NAME);
  } catch (err) {
    console.error('[IGM] DB init error:', err.message);
  }
}

async function audit(recordId, action, changedBy) {
  try {
    await pool.query('INSERT INTO audit_log (table_name, record_id, action_type, changed_by) VALUES ($1, $2, $3, $4)', [TABLE_NAME, recordId, action, changedBy || 'system']);
  } catch (err) {
    console.error('[IGM] Audit error:', err.message);
  }
}

app.get('/api/records', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM ' + TABLE_NAME + ' ORDER BY created_at DESC');
    res.json({ success: true, records: result.rows, entity: ENTITY_LABEL });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/records/:id', async (req, res) => {
  try {
    const record = await pool.query('SELECT * FROM ' + TABLE_NAME + ' WHERE id = $1', [req.params.id]);
    const contacts = await pool.query('SELECT * FROM contact_log WHERE record_id = $1 ORDER BY created_at DESC', [req.params.id]);
    if (!record.rows[0]) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, record: record.rows[0], contacts: contacts.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/records', async (req, res) => {
  try {
    const { field_1, field_2, field_3, field_4, field_5, field_6, status, notes } = req.body;
    const result = await pool.query('INSERT INTO ' + TABLE_NAME + ' (field_1, field_2, field_3, field_4, field_5, field_6, status, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [field_1, field_2, field_3, field_4, field_5, field_6, status || 'active', notes]);
    await audit(result.rows[0].id, 'INSERT', req.body.created_by);
    res.status(201).json({ success: true, record: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/records/:id', async (req, res) => {
  try {
    const { field_1, field_2, field_3, field_4, field_5, field_6, status, notes } = req.body;
    const result = await pool.query('UPDATE ' + TABLE_NAME + ' SET field_1=$1, field_2=$2, field_3=$3, field_4=$4, field_5=$5, field_6=$6, status=$7, notes=$8, updated_at=CURRENT_TIMESTAMP WHERE id=$9 RETURNING *', [field_1, field_2, field_3, field_4, field_5, field_6, status, notes, req.params.id]);
    await audit(req.params.id, 'UPDATE', req.body.updated_by);
    res.json({ success: true, record: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/contacts', async (req, res) => {
  try {
    const { record_id, contact_type, notes, author } = req.body;
    const result = await pool.query('INSERT INTO contact_log (record_id, contact_type, notes, author) VALUES ($1,$2,$3,$4) RETURNING *', [record_id, contact_type, notes, author]);
    res.status(201).json({ success: true, contact: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const total = await pool.query('SELECT COUNT(*) FROM ' + TABLE_NAME);
    const active = await pool.query('SELECT COUNT(*) FROM ' + TABLE_NAME + ' WHERE status = \'active\'');
    const recent = await pool.query('SELECT COUNT(*) FROM ' + TABLE_NAME + ' WHERE created_at > NOW() - INTERVAL \'30 days\'');
    const auditCount = await pool.query('SELECT COUNT(*) FROM audit_log');
    res.json({ success: true, stats: { total: parseInt(total.rows[0].count), active: parseInt(active.rows[0].count), recent_30_days: parseInt(recent.rows[0].count), audit_entries: parseInt(auditCount.rows[0].count), nexus_name: NEXUS_NAME, entity_label: ENTITY_LABEL, igm_governed: true } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ success: true, nexus: NEXUS_NAME, igm: 'GOVERNED', timestamp: new Date().toISOString() });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log('[IGM] ' + NEXUS_NAME + ' running on port ' + PORT);
  });
});
