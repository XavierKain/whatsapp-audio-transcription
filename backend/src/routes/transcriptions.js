const express = require('express');
const { requireAuth } = require('../middleware/auth');
const supabase = require('../db/supabase');

const router = express.Router();

// GET /transcriptions — paginated list, visible=true only
router.get('/', requireAuth, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
  const offset = (page - 1) * limit;

  const { data, error, count } = await supabase
    .from('transcriptions')
    .select('*', { count: 'exact' })
    .eq('user_id', req.userId)
    .eq('visible', true)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Count hidden transcriptions for current month
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { count: hiddenCount } = await supabase
    .from('transcriptions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', req.userId)
    .eq('visible', false)
    .gte('created_at', startOfMonth);

  return res.json({
    transcriptions: data,
    total: count,
    page,
    limit,
    hiddenTranscriptions: hiddenCount || 0,
  });
});

// GET /transcriptions/:id — single transcription
router.get('/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('transcriptions')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'Transcription not found' });
  }

  return res.json(data);
});

module.exports = router;
