import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Navbar from '../components/Navbar'

interface Profile { id: string; full_name: string | null; role: string; department_id: string | null }
interface Department { id: string; name: string }

type Audience = 'global' | 'department'
type PostType = 'announcement' | 'news_event'
type Step = 'compose' | 'settings' | 'preview'

const MAX_CHARS = 2000

interface PollDraft {
  enabled: boolean
  question: string
  options: string[]
  multipleChoice: boolean
  endsAt: string
}

export default function CreatePostPage() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('compose')

  // Post fields
  const [audience, setAudience] = useState<Audience>('global')
  const [selectedDeptId, setSelectedDeptId] = useState('')
  const [postType, setPostType] = useState<PostType>('announcement')
  const [mustRead, setMustRead] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [eventStart, setEventStart] = useState('')
  const [eventEnd, setEventEnd] = useState('')
  const [attachmentUrl, setAttachmentUrl] = useState('')
  const [showAttachment, setShowAttachment] = useState(false)
  const [attachPreviewOk, setAttachPreviewOk] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [published, setPublished] = useState(false)

  // Poll
  const [poll, setPoll] = useState<PollDraft>({
    enabled: false,
    question: '',
    options: ['', ''],
    multipleChoice: false,
    endsAt: ''
  })

  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { navigate('/login'); return }
      setUserId(user.id)
      const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      if (!p || !['hr', 'manager', 'admin'].includes(p.role)) { navigate('/dashboard'); return }
      setProfile(p)
      const { data: ds } = await supabase.from('departments').select('*').order('name')
      setDepartments(ds ?? [])
    }
    load()
    setTimeout(() => titleRef.current?.focus(), 300)
  }, [navigate])

  async function handlePublish() {
    if (!title.trim()) { setError('Please add a title.'); setStep('compose'); return }
    if (!content.trim() && !poll.enabled) { setError('Please add some content or enable a poll.'); setStep('compose'); return }
    if (audience === 'department' && !selectedDeptId) { setError('Please select a department.'); setStep('settings'); return }
    if (poll.enabled) {
      if (!poll.question.trim()) { setError('Please add a poll question.'); setStep('compose'); return }
      const validOptions = poll.options.filter(o => o.trim())
      if (validOptions.length < 2) { setError('Please add at least 2 poll options.'); setStep('compose'); return }
    }

    setSubmitting(true)
    setError(null)

    const { data: post, error: insertError } = await supabase.from('posts').insert({
      author_id: userId,
      title: title.trim(),
      content: content.trim() || null,
      post_type: postType,
      must_read: mustRead,
      department_id: audience === 'department' ? selectedDeptId : null,
      recipient_id: null,
      attachment_url: attachmentUrl.trim() || null,
      event_start: postType === 'news_event' && eventStart ? eventStart : null,
      event_end: postType === 'news_event' && eventEnd ? eventEnd : null,
      post_status: 'published',
    }).select().single()

    if (insertError || !post) {
      setError(insertError?.message ?? 'Failed to create post')
      setSubmitting(false)
      return
    }

    // Create poll if enabled
    if (poll.enabled && poll.question.trim()) {
      const validOptions = poll.options.filter(o => o.trim())
      const { data: pollQ } = await supabase.from('poll_questions').insert({
        post_id: post.id,
        question: poll.question.trim(),
        multiple_choice: poll.multipleChoice,
        ends_at: poll.endsAt || null,
      }).select().single()

      if (pollQ) {
        await supabase.from('poll_options').insert(
          validOptions.map((text, i) => ({
            poll_id: pollQ.id,
            option_text: text.trim(),
            order_index: i,
          }))
        )
      }
    }

    setPublished(true)
    setTimeout(() => navigate('/dashboard'), 2200)
  }

  function canProceedToSettings() {
    return title.trim().length > 0 && (content.trim().length > 0 || poll.enabled)
  }

  function updatePollOption(idx: number, val: string) {
    setPoll(prev => {
      const opts = [...prev.options]
      opts[idx] = val
      return { ...prev, options: opts }
    })
  }
  function addPollOption() {
    if (poll.options.length >= 6) return
    setPoll(prev => ({ ...prev, options: [...prev.options, ''] }))
  }
  function removePollOption(idx: number) {
    if (poll.options.length <= 2) return
    setPoll(prev => ({ ...prev, options: prev.options.filter((_, i) => i !== idx) }))
  }

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length
  const charCount = content.length
  const charPct = Math.min(100, (charCount / MAX_CHARS) * 100)
  const charColor = charPct > 90 ? '#C0504D' : charPct > 75 ? '#F79646' : '#4BACC6'
  const charLabelClass = charPct > 90 ? 'danger' : charPct > 75 ? 'warn' : ''
  const audienceDept = departments.find(d => d.id === selectedDeptId)
  const audienceLabel = audience === 'global' ? 'Everyone' : audienceDept ? audienceDept.name : 'Select dept'
  const ini = (profile?.full_name ?? '?').split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase()

  // Checklist
  const checks = [
    { label: 'Title added', done: title.trim().length > 0 },
    { label: 'Content written', done: content.trim().length > 0 || poll.enabled },
    { label: 'Audience set', done: audience === 'global' || !!selectedDeptId },
    { label: poll.enabled ? 'Poll configured' : 'Poll (optional)', done: !poll.enabled || (poll.question.trim().length > 0 && poll.options.filter(o => o.trim()).length >= 2) },
    { label: postType === 'news_event' ? 'Event date set' : 'Post type set', done: postType === 'announcement' || !!eventStart },
  ]

  if (published) {
    return (
      <>
        <style>{`
          .cp-success { min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1A2B3C,#243F60,#365F91);font-family:'Nunito',sans-serif;flex-direction:column;gap:1.5rem;text-align:center;padding:2rem; }
          @keyframes popIn { from{opacity:0;transform:scale(0.5)} to{opacity:1;transform:scale(1)} }
          @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
          .success-check { width:80px;height:80px;border-radius:50%;background:rgba(75,172,198,0.2);border:2px solid rgba(75,172,198,0.5);display:flex;align-items:center;justify-content:center;font-size:2rem;animation:popIn 0.4s cubic-bezier(0.34,1.56,0.64,1); }
        `}</style>
        <div className="cp-success">
          <div className="success-check">✓</div>
          <h2 style={{ color:'white', fontWeight:800, fontSize:'1.65rem', margin:0, animation:'fadeUp 0.4s ease 0.15s both' }}>Post published!</h2>
          {poll.enabled && <p style={{ color:'rgba(255,255,255,0.55)', margin:0, fontSize:'0.9rem', animation:'fadeUp 0.4s ease 0.2s both' }}>Poll attached · voting is now open</p>}
          <p style={{ color:'rgba(255,255,255,0.45)', margin:0, fontSize:'0.85rem', animation:'fadeUp 0.4s ease 0.25s both' }}>Redirecting to dashboard…</p>
        </div>
      </>
    )
  }

  return (
    <>
      <style>{`
        @keyframes slideRight { from{opacity:0;transform:translateX(20px)} to{opacity:1;transform:translateX(0)} }
        @keyframes fadeIn     { from{opacity:0} to{opacity:1} }
        @keyframes slideDown  { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }

        *, *::before, *::after { box-sizing:border-box; }

        .cp-page { min-height:100vh;background:var(--bg-page);font-family:'Nunito','Segoe UI',system-ui,sans-serif; }

        /* Progress bar */
        .cp-progress { background:var(--bg-surface);border-bottom:1px solid var(--border);padding:0 2rem;display:flex;align-items:center;gap:0;position:sticky;top:60px;z-index:100;overflow-x:auto; }
        .cp-progress::-webkit-scrollbar { display:none; }
        .cp-step { display:flex;align-items:center;gap:0.6rem;padding:1rem 1.25rem;cursor:pointer;transition:all 0.15s;border-bottom:2px solid transparent;font-size:0.85rem;font-weight:500;color:var(--text-faint);background:none;border-top:none;border-left:none;border-right:none;font-family:inherit;white-space:nowrap; }
        .cp-step:hover:not(.disabled) { color:var(--text-primary); }
        .cp-step.active { color:var(--text-primary);font-weight:700;border-bottom-color:#4BACC6; }
        .cp-step.done { color:#4F81BD; }
        .cp-step.disabled { cursor:not-allowed;opacity:0.4; }
        .cp-step-num { width:22px;height:22px;border-radius:50%;border:2px solid currentColor;display:flex;align-items:center;justify-content:center;font-size:0.68rem;font-weight:800;flex-shrink:0; }
        .cp-step.active .cp-step-num { background:#243F60;border-color:#243F60;color:white; }
        .cp-step.done .cp-step-num { background:#4F81BD;border-color:#4F81BD;color:white; }
        .cp-step-arrow { color:var(--border);font-size:0.8rem;margin:0 0.15rem; }

        /* Layout */
        .cp-body { max-width:1100px;margin:0 auto;padding:2rem 1.5rem 5rem;display:grid;grid-template-columns:1fr 300px;gap:1.5rem;align-items:start; }

        .cp-panel { animation:slideRight 0.25s ease; }
        .cp-card { background:var(--bg-surface);border:1px solid var(--border);border-radius:16px;overflow:hidden;margin-bottom:1rem; }

        /* ── Compose step ── */
        .cp-compose-topbar { display:flex;align-items:center;gap:0.75rem;padding:0.9rem 1.5rem;border-bottom:1px solid var(--border);flex-wrap:wrap; }
        .cp-type-pill { display:flex;align-items:center;gap:0.35rem;padding:0.32rem 0.85rem;border-radius:999px;border:1.5px solid;font-size:0.78rem;font-weight:700;cursor:pointer;transition:all 0.15s;background:transparent;font-family:inherit; }
        .cp-type-pill.ann { border-color:#C5D9F1;color:#365F91; }
        .cp-type-pill.ann.active { background:#EEF4FB;border-color:#4F81BD; }
        .cp-type-pill.event { border-color:#D9CCF0;color:#8064A2; }
        .cp-type-pill.event.active { background:#F3EEF9;border-color:#8064A2; }

        .cp-toggle-row { display:flex;align-items:center;gap:0.5rem;margin-left:auto; }
        .cp-toggle-label { font-size:0.78rem;font-weight:600;color:var(--text-muted); }
        .cp-toggle { position:relative;width:42px;height:22px;flex-shrink:0; }
        .cp-toggle input { opacity:0;width:0;height:0;position:absolute; }
        .cp-toggle-track { position:absolute;inset:0;border-radius:999px;background:#e5e7eb;cursor:pointer;transition:background 0.2s; }
        .cp-toggle input:checked + .cp-toggle-track { background:#4BACC6; }
        .cp-toggle-track::after { content:'';position:absolute;left:3px;top:3px;width:16px;height:16px;border-radius:50%;background:white;transition:transform 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.15); }
        .cp-toggle input:checked + .cp-toggle-track::after { transform:translateX(20px); }

        .cp-compose-body { padding:1.75rem 1.75rem 1rem; }
        .cp-author-row { display:flex;align-items:center;gap:0.85rem;margin-bottom:1.5rem; }
        .cp-author-avatar { width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#4BACC6,#243F60);color:white;font-size:0.95rem;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0; }
        .cp-author-info { flex:1; }
        .cp-author-name { font-size:0.92rem;font-weight:700;color:var(--text-primary); }
        .cp-author-sub { display:flex;align-items:center;gap:0.5rem;margin-top:0.2rem;flex-wrap:wrap; }
        .cp-author-role { font-size:0.72rem;color:var(--text-faint);text-transform:capitalize; }
        .cp-audience-pill { display:inline-flex;align-items:center;gap:0.35rem;background:#EEF4FB;border:1px solid #C5D9F1;border-radius:999px;padding:0.18rem 0.6rem;font-size:0.72rem;font-weight:700;color:#365F91;cursor:pointer;transition:all 0.12s; }
        .cp-audience-pill:hover { background:#C5D9F1; }

        .cp-title-input { width:100%;border:none;font-size:1.55rem;font-weight:800;color:var(--text-primary);outline:none;background:transparent;line-height:1.25;letter-spacing:-0.02em;font-family:inherit;margin-bottom:0.85rem;padding:0; }
        .cp-title-input::placeholder { color:var(--text-ghost); }
        .cp-divider { border:none;border-top:1px solid var(--border-light);margin:0.25rem 0 1rem; }
        .cp-content-textarea { width:100%;min-height:180px;border:none;font-size:0.96rem;color:var(--text-secondary);outline:none;resize:none;background:transparent;line-height:1.75;font-family:'Source Serif 4','Cambria','Georgia',serif; }
        .cp-content-textarea::placeholder { color:var(--text-ghost);font-family:'Nunito',sans-serif; }

        /* ── Poll section ── */
        .cp-poll-section { border-top:1px solid var(--border);padding:1.1rem 1.5rem; }
        .cp-poll-section-header { display:flex;align-items:center;justify-content:space-between;margin-bottom:0; }
        .cp-poll-section-title { display:flex;align-items:center;gap:0.5rem;font-size:0.82rem;font-weight:700;color:var(--text-muted); }
        .cp-poll-form { margin-top:1rem;display:flex;flex-direction:column;gap:0.75rem;animation:slideDown 0.2s ease; }
        .cp-poll-q-label { font-size:0.7rem;font-weight:800;color:var(--text-faint);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:0.3rem;display:block; }
        .cp-poll-question { width:100%;padding:0.65rem 0.9rem;border:1.5px solid var(--border);border-radius:10px;font-size:0.9rem;color:var(--text-primary);background:var(--bg-surface);font-family:inherit;outline:none;transition:border-color 0.15s; }
        .cp-poll-question:focus { border-color:#4BACC6;box-shadow:0 0 0 3px rgba(75,172,198,0.1); }
        .cp-poll-options-label { font-size:0.7rem;font-weight:800;color:var(--text-faint);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:0.35rem;display:block; }
        .cp-poll-option-row { display:flex;align-items:center;gap:0.5rem; }
        .cp-poll-option-letter { width:22px;height:22px;border-radius:50%;background:var(--bg-hover);border:1.5px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:800;color:var(--text-faint);flex-shrink:0; }
        .cp-poll-option-input { flex:1;padding:0.5rem 0.8rem;border:1px solid var(--border);border-radius:8px;font-size:0.85rem;color:var(--text-primary);background:var(--bg-page);font-family:inherit;outline:none;transition:border-color 0.15s; }
        .cp-poll-option-input:focus { border-color:#4BACC6; }
        .cp-poll-option-remove { background:none;border:none;color:var(--text-ghost);cursor:pointer;font-size:0.85rem;padding:0.2rem 0.3rem;border-radius:5px;transition:all 0.12s;flex-shrink:0;line-height:1; }
        .cp-poll-option-remove:hover { background:#FEF2F2;color:#dc2626; }
        .cp-poll-option-remove:disabled { opacity:0.2;cursor:not-allowed; }
        .cp-poll-add-btn { display:flex;align-items:center;gap:0.4rem;padding:0.45rem 0.9rem;background:transparent;border:1.5px dashed var(--border);border-radius:9px;font-size:0.8rem;font-weight:600;color:var(--text-muted);cursor:pointer;transition:all 0.15s;font-family:inherit;width:100%; }
        .cp-poll-add-btn:hover:not(:disabled) { border-color:#4BACC6;color:#243F60;background:#EEF4FB; }
        .cp-poll-add-btn:disabled { opacity:0.3;cursor:not-allowed; }
        .cp-poll-extras { display:flex;align-items:center;gap:1.25rem;flex-wrap:wrap;padding-top:0.25rem; }
        .cp-poll-extra-row { display:flex;align-items:center;gap:0.45rem;font-size:0.8rem;color:var(--text-secondary);cursor:pointer; }
        .cp-poll-extra-row input[type="checkbox"] { width:15px;height:15px;cursor:pointer;accent-color:#4BACC6; }
        .cp-poll-date-row { display:flex;align-items:center;gap:0.45rem;font-size:0.8rem;color:var(--text-secondary); }
        .cp-poll-date-input { padding:0.32rem 0.6rem;border:1px solid var(--border);border-radius:7px;font-size:0.78rem;color:var(--text-primary);background:var(--bg-surface);font-family:inherit;outline:none; }
        .cp-poll-date-input:focus { border-color:#4BACC6; }

        /* Attachment */
        .cp-attach-bar { border-top:1px solid var(--border);padding:0.75rem 1.5rem;display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap; }
        .cp-attach-toggle { display:flex;align-items:center;gap:0.4rem;padding:0.32rem 0.85rem;border:1.5px dashed var(--border);border-radius:9px;font-size:0.8rem;font-weight:600;color:var(--text-muted);background:transparent;cursor:pointer;transition:all 0.15s;font-family:inherit; }
        .cp-attach-toggle:hover { border-color:#4BACC6;color:#243F60;background:#EEF4FB; }
        .cp-attach-input-wrap { flex:1;display:flex;align-items:center;gap:0.5rem;background:#EEF4FB;border:1.5px solid #4BACC6;border-radius:9px;padding:0.4rem 0.75rem;animation:fadeIn 0.15s ease; }
        .cp-attach-input-wrap input { flex:1;border:none;background:transparent;font-size:0.82rem;color:var(--text-primary);outline:none;font-family:inherit; }
        .cp-attach-preview { width:48px;height:48px;border-radius:8px;object-fit:cover;flex-shrink:0;border:1px solid #C5D9F1; }
        .cp-attach-clear { background:none;border:none;color:#9CA3AF;cursor:pointer;font-size:0.8rem;padding:0.2rem;border-radius:5px;line-height:1; }
        .cp-attach-clear:hover { background:#FEF2F2;color:#dc2626; }

        /* Footer */
        .cp-compose-footer { display:flex;align-items:center;justify-content:space-between;padding:0.9rem 1.5rem;border-top:1px solid var(--border);gap:1rem;flex-wrap:wrap; }
        .cp-char-wrap { display:flex;align-items:center;gap:0.75rem;flex:1; }
        .cp-char-bar { width:120px; }
        .cp-char-track { height:3px;background:var(--border);border-radius:999px;overflow:hidden;margin-bottom:0.28rem; }
        .cp-char-fill { height:100%;border-radius:999px;transition:width 0.2s,background 0.2s; }
        .cp-char-label { font-size:0.7rem;color:var(--text-ghost);font-weight:600; }
        .cp-char-label.warn { color:#F79646; }
        .cp-char-label.danger { color:#C0504D; }
        .cp-word-count { font-size:0.7rem;color:var(--text-ghost); }
        .cp-footer-actions { display:flex;align-items:center;gap:0.6rem; }
        .btn-ghost { padding:0.5rem 1.1rem;background:transparent;border:1.5px solid var(--border);border-radius:9px;font-size:0.85rem;font-weight:600;color:var(--text-muted);cursor:pointer;transition:all 0.15s;font-family:inherit; }
        .btn-ghost:hover { background:var(--bg-hover);border-color:var(--text-faint); }
        .btn-blue { padding:0.5rem 1.35rem;background:#243F60;border:none;border-radius:9px;font-size:0.85rem;font-weight:700;color:white;cursor:pointer;transition:background 0.15s;font-family:inherit; }
        .btn-blue:hover:not(:disabled) { background:#365F91; }
        .btn-blue:disabled { opacity:0.4;cursor:not-allowed; }

        /* ── Settings step ── */
        .cp-settings-section { padding:1.35rem 1.5rem;border-bottom:1px solid var(--border); }
        .cp-settings-section:last-child { border-bottom:none; }
        .cp-settings-section-title { font-size:0.72rem;font-weight:700;color:var(--text-faint);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:1rem; }
        .cp-audience-grid { display:grid;grid-template-columns:1fr 1fr;gap:0.6rem; }
        .cp-audience-card { border:2px solid var(--border);border-radius:12px;padding:1.1rem;cursor:pointer;transition:all 0.15s;background:var(--bg-surface);text-align:left;display:flex;flex-direction:column;gap:0.4rem;font-family:inherit; }
        .cp-audience-card:hover { border-color:#4BACC6; }
        .cp-audience-card.selected { border-color:#4BACC6;background:#EEF4FB; }
        .cp-audience-card-icon { font-size:1.5rem; }
        .cp-audience-card-label { font-size:0.88rem;font-weight:700;color:var(--text-primary); }
        .cp-audience-card-desc { font-size:0.72rem;color:var(--text-faint);line-height:1.4; }
        .cp-select { width:100%;padding:0.6rem 0.85rem;border:1.5px solid var(--border);border-radius:9px;font-size:0.88rem;color:var(--text-primary);background:var(--bg-surface);font-family:inherit;outline:none;margin-top:0.6rem; }
        .cp-select:focus { border-color:#4BACC6; }
        .cp-type-grid { display:grid;grid-template-columns:1fr 1fr;gap:0.6rem; }
        .cp-type-card { border:2px solid var(--border);border-radius:12px;padding:1.1rem;cursor:pointer;transition:all 0.15s;background:var(--bg-surface);text-align:left;display:flex;flex-direction:column;gap:0.4rem;font-family:inherit; }
        .cp-type-card:hover { border-color:#4BACC6; }
        .cp-type-card.selected { border-color:#4BACC6;background:#EEF4FB; }
        .cp-type-card.selected.event { border-color:#8064A2;background:#F3EEF9; }
        .cp-type-card-icon { font-size:1.5rem; }
        .cp-type-card-label { font-size:0.88rem;font-weight:700;color:var(--text-primary); }
        .cp-type-card-desc { font-size:0.72rem;color:var(--text-faint);line-height:1.4; }
        .cp-date-grid { display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;margin-top:0.6rem;animation:slideDown 0.2s ease; }
        .cp-date-field { display:flex;flex-direction:column;gap:0.3rem; }
        .cp-date-field label { font-size:0.7rem;font-weight:700;color:var(--text-faint);text-transform:uppercase;letter-spacing:0.05em; }
        .cp-date-field input { padding:0.55rem 0.75rem;border:1.5px solid var(--border);border-radius:8px;font-size:0.82rem;color:var(--text-primary);background:var(--bg-surface);font-family:inherit;outline:none; }
        .cp-date-field input:focus { border-color:#4BACC6; }
        .cp-mustread-row { display:flex;align-items:center;justify-content:space-between;gap:1rem; }
        .cp-mustread-text .cp-mustread-label { font-size:0.88rem;font-weight:700;color:var(--text-primary);display:block;margin-bottom:0.2rem; }
        .cp-mustread-text .cp-mustread-desc { font-size:0.75rem;color:var(--text-faint);line-height:1.4; }
        .cp-settings-footer { display:flex;align-items:center;justify-content:space-between;padding:1rem 1.5rem;border-top:1px solid var(--border);gap:0.6rem; }

        /* ── Preview step ── */
        .cp-preview-card { background:var(--bg-surface);border:1px solid var(--border);border-radius:16px;padding:1.5rem;margin-bottom:1rem; }
        .cp-preview-header { display:flex;align-items:flex-start;gap:0.75rem;margin-bottom:1rem; }
        .cp-preview-avatar { width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#4BACC6,#243F60);color:white;font-size:0.9rem;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0; }
        .cp-preview-name { font-size:0.88rem;font-weight:700;color:var(--text-primary); }
        .cp-preview-meta { font-size:0.72rem;color:var(--text-faint);margin-top:0.15rem;display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap; }
        .cp-preview-badge { font-size:0.62rem;font-weight:700;padding:0.12rem 0.45rem;border-radius:4px;text-transform:uppercase;letter-spacing:0.05em; }
        .cp-preview-badge.ann { background:#EEF4FB;color:#365F91;border:1px solid #C5D9F1; }
        .cp-preview-badge.event { background:#F3EEF9;color:#8064A2;border:1px solid #D9CCF0; }
        .cp-preview-badge.must { background:#FEF2F2;color:#C0504D;border:1px solid #F4BDBB; }
        .cp-preview-badge.poll { background:#FFF7ED;color:#c2410c;border:1px solid #fed7aa; }
        .cp-preview-title { font-size:1.2rem;font-weight:800;color:var(--text-primary);margin-bottom:0.6rem;letter-spacing:-0.01em;line-height:1.3; }
        .cp-preview-content { font-size:0.92rem;color:var(--text-secondary);line-height:1.75;white-space:pre-wrap;font-family:'Source Serif 4','Georgia',serif;margin-bottom:0.75rem; }
        .cp-preview-event-card { display:flex;align-items:center;gap:0.65rem;background:#F3EEF9;border:1px solid #D9CCF0;border-radius:9px;padding:0.65rem 0.9rem;margin-bottom:0.75rem; }
        .cp-preview-event-date { font-size:0.82rem;font-weight:700;color:#8064A2; }
        .cp-preview-img { width:100%;max-height:220px;object-fit:cover;border-radius:10px;margin-bottom:0.75rem;display:block;border:1px solid var(--border); }
        .cp-preview-poll { background:var(--bg-page);border:1.5px solid #C5D9F1;border-radius:12px;padding:1rem 1.1rem;margin-bottom:0.75rem; }
        .cp-preview-poll-q { font-size:0.9rem;font-weight:700;color:var(--text-primary);margin-bottom:0.65rem;display:flex;align-items:center;gap:0.5rem; }
        .cp-preview-poll-option { display:flex;align-items:center;gap:0.65rem;padding:0.5rem 0.8rem;border:1.5px solid var(--border);border-radius:8px;margin-bottom:0.4rem;background:var(--bg-surface); }
        .cp-preview-poll-dot { width:14px;height:14px;border-radius:50%;border:2px solid var(--border);flex-shrink:0; }
        .cp-preview-poll-text { font-size:0.85rem;font-weight:600;color:var(--text-secondary); }
        .cp-preview-poll-meta { font-size:0.72rem;color:var(--text-faint);margin-top:0.35rem;display:flex;align-items:center;gap:0.5rem; }
        .cp-preview-footer { display:flex;align-items:center;justify-content:flex-end;gap:0.6rem;padding-top:0.85rem;border-top:1px solid var(--border);margin-top:0.5rem; }

        /* Error */
        .cp-error { background:#FEF2F2;border:1px solid #F4BDBB;border-radius:9px;padding:0.75rem 1rem;font-size:0.82rem;color:#C0504D;font-weight:600;display:flex;align-items:center;gap:0.5rem;margin-bottom:0.85rem; }

        /* ── Sidebar ── */
        .cp-sidebar-card { background:var(--bg-surface);border:1px solid var(--border);border-radius:14px;overflow:hidden;margin-bottom:1rem; }
        .cp-sidebar-header { display:flex;align-items:center;gap:0.6rem;padding:0.9rem 1.1rem;border-bottom:1px solid var(--border); }
        .cp-sidebar-header-icon { width:28px;height:28px;border-radius:7px;background:#EEF4FB;display:flex;align-items:center;justify-content:center;font-size:0.85rem;flex-shrink:0; }
        .cp-sidebar-title { font-size:0.82rem;font-weight:700;color:var(--text-primary); }
        .cp-summary-row { display:flex;align-items:center;justify-content:space-between;padding:0.6rem 1.1rem;border-bottom:1px solid var(--border-light); }
        .cp-summary-row:last-child { border-bottom:none; }
        .cp-summary-label { font-size:0.75rem;color:var(--text-faint); }
        .cp-summary-value { font-size:0.78rem;font-weight:700;color:var(--text-primary);max-width:140px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
        .cp-check-row { display:flex;align-items:center;gap:0.6rem;padding:0.5rem 1.1rem;border-bottom:1px solid var(--border-light); }
        .cp-check-row:last-child { border-bottom:none; }
        .cp-check-dot { width:16px;height:16px;border-radius:50%;border:2px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:0.55rem;flex-shrink:0;transition:all 0.2s; }
        .cp-check-dot.done { background:#9BBB59;border-color:#9BBB59;color:white; }
        .cp-check-label { font-size:0.75rem;color:var(--text-muted); }
        .cp-check-label.done { color:var(--text-primary);font-weight:600; }

        .cp-tips { padding:0.9rem 1.1rem; }
        .cp-tip { display:flex;align-items:flex-start;gap:0.5rem;font-size:0.75rem;color:var(--text-muted);line-height:1.5;margin-bottom:0.6rem; }
        .cp-tip:last-child { margin-bottom:0; }
        .cp-tip-icon { flex-shrink:0;margin-top:0.05rem; }

        @media(max-width:900px) { .cp-body{grid-template-columns:1fr} .cp-sidebar{display:none} }
        @media(max-width:600px) { .cp-audience-grid,.cp-type-grid,.cp-date-grid{grid-template-columns:1fr} .cp-body{padding:1rem 1rem 4rem} }
      `}</style>

      <div className="cp-page">
        <Navbar fullName={profile?.full_name ?? null} role={profile?.role ?? 'employee'} />

        {/* Progress */}
        <div className="cp-progress">
          {(['compose', 'settings', 'preview'] as Step[]).map((s, i) => {
            const labels = ['Compose', 'Settings', 'Preview']
            const icons = ['✏️', '⚙️', '👁']
            const stepIdx = ['compose','settings','preview'].indexOf(step)
            const thisIdx = i
            const isDone = thisIdx < stepIdx
            const isActive = s === step
            const isDisabled = s === 'settings' ? !canProceedToSettings() : s === 'preview' ? !canProceedToSettings() : false
            return (
              <div key={s} style={{ display:'flex', alignItems:'center' }}>
                {i > 0 && <span className="cp-step-arrow">›</span>}
                <button
                  className={`cp-step${isActive ? ' active' : ''}${isDone ? ' done' : ''}${isDisabled && !isDone ? ' disabled' : ''}`}
                  onClick={() => !isDisabled && setStep(s)}
                >
                  <span className="cp-step-num">{isDone ? '✓' : i + 1}</span>
                  <span style={{ fontSize:'0.82rem' }}>{icons[i]}</span>
                  {labels[i]}
                </button>
              </div>
            )
          })}
        </div>

        <div className="cp-body">
          <div className="cp-panel">

            {/* ── COMPOSE ── */}
            {step === 'compose' && (
              <div className="cp-card">
                {/* Top bar */}
                <div className="cp-compose-topbar">
                  <button className={`cp-type-pill ann${postType==='announcement'?' active':''}`} onClick={()=>setPostType('announcement')}>
                    📢 Announcement
                  </button>
                  <button className={`cp-type-pill event${postType==='news_event'?' active':''}`} onClick={()=>setPostType('news_event')}>
                    📅 Event
                  </button>
                  <div className="cp-toggle-row">
                    <span className="cp-toggle-label">Must-read</span>
                    <label className="cp-toggle">
                      <input type="checkbox" checked={mustRead} onChange={e=>setMustRead(e.target.checked)} />
                      <div className="cp-toggle-track" />
                    </label>
                  </div>
                </div>

                {/* Body */}
                <div className="cp-compose-body">
                  <div className="cp-author-row">
                    <div className="cp-author-avatar">{ini}</div>
                    <div className="cp-author-info">
                      <div className="cp-author-name">{profile?.full_name ?? 'You'}</div>
                      <div className="cp-author-sub">
                        <span className="cp-author-role">{profile?.role}</span>
                        <span className="cp-audience-pill" onClick={()=>setStep('settings')}>
                          {audience==='global'?'🌐':'🏢'} {audienceLabel} ▾
                        </span>
                      </div>
                    </div>
                  </div>

                  <input
                    ref={titleRef}
                    className="cp-title-input"
                    placeholder="Post title…"
                    value={title}
                    onChange={e=>setTitle(e.target.value)}
                    maxLength={180}
                  />
                  <hr className="cp-divider" />
                  <textarea
                    className="cp-content-textarea"
                    placeholder="What do you want to share with your team? You can leave this empty if you're adding a poll."
                    value={content}
                    onChange={e=>setContent(e.target.value.slice(0, MAX_CHARS))}
                    rows={6}
                    style={{ resize:'vertical' }}
                  />
                </div>

                {/* ── Poll section ── */}
                <div className="cp-poll-section">
                  <div className="cp-poll-section-header">
                    <span className="cp-poll-section-title">
                      <span>📊</span> Add a poll
                    </span>
                    <label className="cp-toggle">
                      <input type="checkbox" checked={poll.enabled} onChange={e=>setPoll(p=>({...p,enabled:e.target.checked}))} />
                      <div className="cp-toggle-track" />
                    </label>
                  </div>

                  {poll.enabled && (
                    <div className="cp-poll-form">
                      <div>
                        <span className="cp-poll-q-label">Poll question *</span>
                        <input
                          className="cp-poll-question"
                          placeholder="e.g. What day works best for the team lunch?"
                          value={poll.question}
                          onChange={e=>setPoll(p=>({...p,question:e.target.value}))}
                        />
                      </div>

                      <div>
                        <span className="cp-poll-options-label">Options (2–6 required)</span>
                        <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem' }}>
                          {poll.options.map((opt, i) => (
                            <div key={i} className="cp-poll-option-row">
                              <div className="cp-poll-option-letter">
                                {String.fromCharCode(65 + i)}
                              </div>
                              <input
                                className="cp-poll-option-input"
                                placeholder={`Option ${String.fromCharCode(65 + i)}${i < 2 ? ' *' : ''}`}
                                value={opt}
                                onChange={e=>updatePollOption(i, e.target.value)}
                              />
                              <button
                                className="cp-poll-option-remove"
                                onClick={()=>removePollOption(i)}
                                disabled={poll.options.length <= 2}
                                title="Remove option"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                        <button
                          className="cp-poll-add-btn"
                          onClick={addPollOption}
                          disabled={poll.options.length >= 6}
                          style={{ marginTop:'0.5rem' }}
                        >
                          + Add option {poll.options.length < 6 ? `(${poll.options.length}/6)` : '(max 6)'}
                        </button>
                      </div>

                      <div className="cp-poll-extras">
                        <label className="cp-poll-extra-row">
                          <input
                            type="checkbox"
                            checked={poll.multipleChoice}
                            onChange={e=>setPoll(p=>({...p,multipleChoice:e.target.checked}))}
                          />
                          Allow multiple choices
                        </label>
                        <div className="cp-poll-date-row">
                          <span>⏱ Ends:</span>
                          <input
                            type="datetime-local"
                            className="cp-poll-date-input"
                            value={poll.endsAt}
                            onChange={e=>setPoll(p=>({...p,endsAt:e.target.value}))}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Attachment */}
                <div className="cp-attach-bar">
                  {!showAttachment ? (
                    <button className="cp-attach-toggle" onClick={()=>setShowAttachment(true)}>
                      🖼 Add image URL
                    </button>
                  ) : (
                    <div className="cp-attach-input-wrap">
                      <span style={{ fontSize:'0.85rem', color:'var(--text-faint)' }}>🔗</span>
                      <input
                        placeholder="https://example.com/image.jpg"
                        value={attachmentUrl}
                        onChange={e=>{ setAttachmentUrl(e.target.value); setAttachPreviewOk(false) }}
                      />
                      {attachmentUrl && attachPreviewOk && (
                        <img className="cp-attach-preview" src={attachmentUrl} alt="" />
                      )}
                      {attachmentUrl && (
                        <img src={attachmentUrl} alt="" style={{ display:'none' }}
                          onLoad={()=>setAttachPreviewOk(true)}
                          onError={()=>setAttachPreviewOk(false)}
                        />
                      )}
                      <button className="cp-attach-clear" onClick={()=>{ setAttachmentUrl(''); setShowAttachment(false); setAttachPreviewOk(false) }}>✕</button>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="cp-compose-footer">
                  <div className="cp-char-wrap">
                    <div className="cp-char-bar">
                      <div className="cp-char-track">
                        <div className="cp-char-fill" style={{ width:`${charPct}%`, background:charColor }} />
                      </div>
                      <div className={`cp-char-label${charPct>90?' danger':charPct>75?' warn':''}`}>
                        {charCount}/{MAX_CHARS}
                      </div>
                    </div>
                    {wordCount > 0 && <span className="cp-word-count">{wordCount} words</span>}
                  </div>
                  <div className="cp-footer-actions">
                    <button className="btn-ghost" onClick={()=>navigate('/dashboard')}>Cancel</button>
                    <button
                      className="btn-blue"
                      onClick={()=>setStep('settings')}
                      disabled={!canProceedToSettings()}
                    >
                      Settings →
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── SETTINGS ── */}
            {step === 'settings' && (
              <div className="cp-card">
                {/* Audience */}
                <div className="cp-settings-section">
                  <div className="cp-settings-section-title">🎯 Audience</div>
                  <div className="cp-audience-grid">
                    <button className={`cp-audience-card${audience==='global'?' selected':''}`} onClick={()=>setAudience('global')}>
                      <span className="cp-audience-card-icon">🌐</span>
                      <span className="cp-audience-card-label">Everyone</span>
                      <span className="cp-audience-card-desc">Visible to all staff company-wide</span>
                    </button>
                    <button className={`cp-audience-card${audience==='department'?' selected':''}`} onClick={()=>setAudience('department')}>
                      <span className="cp-audience-card-icon">🏢</span>
                      <span className="cp-audience-card-label">Department</span>
                      <span className="cp-audience-card-desc">Target a specific team or department</span>
                    </button>
                  </div>
                  {audience==='department' && (
                    <select className="cp-select" value={selectedDeptId} onChange={e=>setSelectedDeptId(e.target.value)}>
                      <option value="">Select department…</option>
                      {departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  )}
                </div>

                {/* Post type */}
                <div className="cp-settings-section">
                  <div className="cp-settings-section-title">📌 Post type</div>
                  <div className="cp-type-grid">
                    <button className={`cp-type-card${postType==='announcement'?' selected':''}`} onClick={()=>setPostType('announcement')}>
                      <span className="cp-type-card-icon">📢</span>
                      <span className="cp-type-card-label">Announcement</span>
                      <span className="cp-type-card-desc">General updates, news, policies</span>
                    </button>
                    <button className={`cp-type-card event${postType==='news_event'?' selected event':''}`} onClick={()=>setPostType('news_event')}>
                      <span className="cp-type-card-icon">📅</span>
                      <span className="cp-type-card-label">Event</span>
                      <span className="cp-type-card-desc">Meetings, training, social events</span>
                    </button>
                  </div>
                  {postType==='news_event' && (
                    <div className="cp-date-grid">
                      <div className="cp-date-field">
                        <label>Start *</label>
                        <input type="datetime-local" value={eventStart} onChange={e=>setEventStart(e.target.value)} />
                      </div>
                      <div className="cp-date-field">
                        <label>End (optional)</label>
                        <input type="datetime-local" value={eventEnd} onChange={e=>setEventEnd(e.target.value)} min={eventStart} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Must-read */}
                <div className="cp-settings-section">
                  <div className="cp-settings-section-title">⚠ Acknowledgement</div>
                  <div className="cp-mustread-row">
                    <div className="cp-mustread-text">
                      <span className="cp-mustread-label">Must-read post</span>
                      <span className="cp-mustread-desc">Requires staff to acknowledge they've read this post. Track compliance in analytics.</span>
                    </div>
                    <label className="cp-toggle">
                      <input type="checkbox" checked={mustRead} onChange={e=>setMustRead(e.target.checked)} />
                      <div className="cp-toggle-track" />
                    </label>
                  </div>
                </div>

                {/* Footer */}
                <div className="cp-settings-footer">
                  <button className="btn-ghost" onClick={()=>setStep('compose')}>← Back</button>
                  <button className="btn-blue" onClick={()=>setStep('preview')}>Preview →</button>
                </div>
              </div>
            )}

            {/* ── PREVIEW ── */}
            {step === 'preview' && (
              <>
                {error && (
                  <div className="cp-error">⚠ {error}</div>
                )}
                <div className="cp-preview-card">
                  <div className="cp-preview-header">
                    <div className="cp-preview-avatar">{ini}</div>
                    <div>
                      <div className="cp-preview-name">{profile?.full_name ?? 'You'}</div>
                      <div className="cp-preview-meta">
                        <span>Just now</span>
                        <span className={`cp-preview-badge ${postType==='news_event'?'event':'ann'}`}>
                          {postType==='news_event'?'📅 Event':'📢 Announcement'}
                        </span>
                        {mustRead && <span className="cp-preview-badge must">⚠ Must-read</span>}
                        {audience==='department' && audienceDept && <span className="cp-preview-badge ann">🏢 {audienceDept.name}</span>}
                        {poll.enabled && <span className="cp-preview-badge poll">📊 Poll</span>}
                      </div>
                    </div>
                  </div>

                  <div className="cp-preview-title">{title || 'Untitled post'}</div>

                  {content && <div className="cp-preview-content">{content}</div>}

                  {poll.enabled && poll.question.trim() && (
                    <div className="cp-preview-poll">
                      <div className="cp-preview-poll-q">
                        <span>📊</span> {poll.question}
                      </div>
                      {poll.options.filter(o=>o.trim()).map((opt, i) => (
                        <div key={i} className="cp-preview-poll-option">
                          <div className="cp-preview-poll-dot" style={{ borderColor: poll.multipleChoice ? '#4BACC6' : undefined, borderRadius: poll.multipleChoice ? '3px' : undefined }} />
                          <span className="cp-preview-poll-text">{opt}</span>
                        </div>
                      ))}
                      <div className="cp-preview-poll-meta">
                        {poll.multipleChoice && <span>Multiple choice</span>}
                        {poll.endsAt && <span>Ends {new Date(poll.endsAt).toLocaleDateString('en-AU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', hour12:true })}</span>}
                      </div>
                    </div>
                  )}

                  {postType==='news_event' && eventStart && (
                    <div className="cp-preview-event-card">
                      <span style={{ fontSize:'1.1rem' }}>📅</span>
                      <div>
                        <div className="cp-preview-event-date">
                          {new Date(eventStart).toLocaleDateString('en-AU', { weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', hour12:true })}
                        </div>
                        {eventEnd && <div style={{ fontSize:'0.75rem', color:'#9CA3AF' }}>
                          Ends {new Date(eventEnd).toLocaleDateString('en-AU', { weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', hour12:true })}
                        </div>}
                      </div>
                    </div>
                  )}

                  {attachmentUrl && attachPreviewOk && (
                    <img className="cp-preview-img" src={attachmentUrl} alt="Attachment preview" />
                  )}

                  <div className="cp-preview-footer">
                    <button className="btn-ghost" onClick={()=>setStep('settings')}>← Back</button>
                    <button className="btn-blue" onClick={handlePublish} disabled={submitting}>
                      {submitting ? 'Publishing…' : '🚀 Publish post'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ── Sidebar ── */}
          <div className="cp-sidebar" style={{ position:'sticky', top:'110px' }}>

            {/* Post summary */}
            <div className="cp-sidebar-card">
              <div className="cp-sidebar-header">
                <div className="cp-sidebar-header-icon">📋</div>
                <div className="cp-sidebar-title">Post summary</div>
              </div>
              {[
                { label:'Title', value: title || '—' },
                { label:'Type', value: postType==='news_event' ? '📅 Event' : '📢 Announcement' },
                { label:'Audience', value: audienceLabel },
                { label:'Must-read', value: mustRead ? 'Yes ⚠' : 'No' },
                { label:'Poll', value: poll.enabled ? `📊 ${poll.options.filter(o=>o.trim()).length} options` : 'None' },
                { label:'Image', value: attachmentUrl && attachPreviewOk ? '✓ Set' : 'None' },
              ].map(row => (
                <div key={row.label} className="cp-summary-row">
                  <span className="cp-summary-label">{row.label}</span>
                  <span className="cp-summary-value" title={row.value}>{row.value}</span>
                </div>
              ))}
            </div>

            {/* Readiness checklist */}
            <div className="cp-sidebar-card">
              <div className="cp-sidebar-header">
                <div className="cp-sidebar-header-icon">✓</div>
                <div className="cp-sidebar-title">Readiness check</div>
              </div>
              {checks.map(c => (
                <div key={c.label} className="cp-check-row">
                  <div className={`cp-check-dot${c.done?' done':''}`}>{c.done?'✓':''}</div>
                  <span className={`cp-check-label${c.done?' done':''}`}>{c.label}</span>
                </div>
              ))}
            </div>

            {/* Tips */}
            <div className="cp-sidebar-card">
              <div className="cp-sidebar-header">
                <div className="cp-sidebar-header-icon">💡</div>
                <div className="cp-sidebar-title">Writing tips</div>
              </div>
              <div className="cp-tips">
                {[
                  { icon:'📝', tip:'Keep titles short and action-oriented — what does the reader need to know?' },
                  { icon:'📊', tip:'Add a poll to gather quick team feedback or run a vote.' },
                  { icon:'⚠', tip:'Use must-read for critical policies, safety updates, or compliance notices.' },
                  { icon:'📅', tip:'Events with dates show up with a calendar card in the feed.' },
                ].map((t, i) => (
                  <div key={i} className="cp-tip">
                    <span className="cp-tip-icon">{t.icon}</span>
                    {t.tip}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}