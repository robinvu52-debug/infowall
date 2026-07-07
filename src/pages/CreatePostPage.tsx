import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Navbar from '../components/Navbar'

interface Profile {
  id: string; full_name: string | null; role: string; department_id: string | null
}
interface Department { id: string; name: string }

type Audience = 'global' | 'department'
type PostType = 'announcement' | 'news_event'
type Step = 'compose' | 'settings' | 'preview'

const MAX_CHARS = 2000

export default function CreatePostPage() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('compose')

  // Form state
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

  const titleRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLTextAreaElement>(null)

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
    if (!content.trim()) { setError('Please add some content.'); setStep('compose'); return }
    if (audience === 'department' && !selectedDeptId) { setError('Please select a department.'); setStep('settings'); return }
    setSubmitting(true); setError(null)

    const { error: insertError } = await supabase.from('posts').insert({
      author_id: userId,
      title: title.trim(),
      content: content.trim(),
      post_type: postType,
      must_read: mustRead,
      department_id: audience === 'department' ? selectedDeptId : null,
      recipient_id: null,
      attachment_url: attachmentUrl.trim() || null,
      event_start: postType === 'news_event' && eventStart ? eventStart : null,
      event_end: postType === 'news_event' && eventEnd ? eventEnd : null,
    })

    if (insertError) { setError(insertError.message); setSubmitting(false); return }
    setPublished(true)
    setTimeout(() => navigate('/dashboard'), 2200)
  }

  function canProceedToSettings() { return title.trim().length > 0 && content.trim().length > 0 }

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length
  const charCount = content.length
  const charPct = Math.min(100, (charCount / MAX_CHARS) * 100)

  const audienceDept = departments.find(d => d.id === selectedDeptId)
  const audienceLabel = audience === 'global' ? 'Everyone' : audienceDept ? audienceDept.name : 'Select department'

  const initials = (profile?.full_name ?? '?').split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase()

  if (published) {
    return (
      <>
        <style>{`.cp-success{min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1A2B3C,#243F60,#365F91);font-family:'Nunito',sans-serif;flex-direction:column;gap:1.5rem;text-align:center;padding:2rem;}
        .cp-success-icon{width:80px;height:80px;border-radius:50%;background:rgba(75,172,198,0.2);border:2px solid rgba(75,172,198,0.5);display:flex;align-items:center;justify-content:center;font-size:2rem;animation:popIn 0.4s cubic-bezier(0.34,1.56,0.64,1);}
        @keyframes popIn{from{opacity:0;transform:scale(0.5)}to{opacity:1;transform:scale(1)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}`}</style>
        <div className="cp-success">
          <div className="cp-success-icon">✓</div>
          <h2 style={{ color: 'white', fontWeight: 800, fontSize: '1.65rem', margin: 0, animation: 'fadeUp 0.4s ease 0.15s both' }}>Post published!</h2>
          <p style={{ color: 'rgba(255,255,255,0.55)', margin: 0, fontSize: '0.9rem', animation: 'fadeUp 0.4s ease 0.25s both' }}>Redirecting to dashboard…</p>
        </div>
      </>
    )
  }

  return (
    <>
      <style>{`
        @keyframes slideRight { from{opacity:0;transform:translateX(20px)} to{opacity:1;transform:translateX(0)} }
        @keyframes slideLeft  { from{opacity:0;transform:translateX(-20px)} to{opacity:1;transform:translateX(0)} }
        @keyframes fadeIn     { from{opacity:0} to{opacity:1} }
        @keyframes barGrow    { from{width:0} to{width:var(--w)} }

        .cp-page { min-height:100vh; background:#F2F4F7; font-family:'Nunito','Segoe UI',system-ui,sans-serif; }

        /* ── Progress bar ── */
        .cp-progress {
          background:white; border-bottom:1px solid #e5e7eb;
          padding:0 2rem; display:flex; align-items:center; gap:0;
          position:sticky; top:58px; z-index:100;
        }
        .cp-step {
          display:flex; align-items:center; gap:0.6rem;
          padding:1rem 1.25rem; cursor:pointer; transition:all 0.15s;
          border-bottom:2px solid transparent; font-size:0.85rem; font-weight:500; color:#9ca3af;
          background:none; border-top:none; border-left:none; border-right:none;
          font-family:inherit; white-space:nowrap;
        }
        .cp-step:hover:not(.disabled) { color:#243F60; }
        .cp-step.active { color:#243F60; font-weight:700; border-bottom-color:#4BACC6; }
        .cp-step.done { color:#4F81BD; }
        .cp-step.disabled { cursor:not-allowed; opacity:0.4; }
        .cp-step-num {
          width:22px; height:22px; border-radius:50%; border:2px solid currentColor;
          display:flex; align-items:center; justify-content:center; font-size:0.68rem; font-weight:800; flex-shrink:0;
        }
        .cp-step.active .cp-step-num { background:#243F60; border-color:#243F60; color:white; }
        .cp-step.done .cp-step-num { background:#4F81BD; border-color:#4F81BD; color:white; }
        .cp-step-arrow { color:#e5e7eb; font-size:0.8rem; margin:0 0.25rem; }

        /* ── Layout ── */
        .cp-body { max-width:1100px; margin:0 auto; padding:2rem 1.5rem 4rem; display:grid; grid-template-columns:1fr 320px; gap:1.5rem; align-items:start; }

        /* ── Step panels ── */
        .cp-panel { animation:slideRight 0.25s ease; }
        .cp-card { background:white; border:1px solid #e5e7eb; border-radius:16px; overflow:hidden; }

        /* compose step */
        .cp-compose-topbar {
          display:flex; align-items:center; gap:1rem;
          padding:1rem 1.5rem; border-bottom:1px solid #f3f4f6; flex-wrap:wrap;
        }
        .cp-type-pill {
          display:flex; align-items:center; gap:0.35rem;
          padding:0.32rem 0.85rem; border-radius:999px; border:1.5px solid; font-size:0.78rem; font-weight:700;
          cursor:pointer; transition:all 0.15s; background:transparent; font-family:inherit;
        }
        .cp-type-pill.ann { border-color:#C5D9F1; color:#365F91; }
        .cp-type-pill.ann.active { background:#EEF4FB; border-color:#4F81BD; }
        .cp-type-pill.event { border-color:#D9CCF0; color:#8064A2; }
        .cp-type-pill.event.active { background:#F3EEF9; border-color:#8064A2; }

        .cp-compose-body { padding:1.75rem; }

        .cp-author-row { display:flex; align-items:center; gap:0.85rem; margin-bottom:1.5rem; }
        .cp-author-avatar { width:42px; height:42px; border-radius:50%; background:linear-gradient(135deg,#4BACC6,#243F60); color:white; font-size:0.95rem; font-weight:800; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        .cp-author-name { font-size:0.92rem; font-weight:700; color:#1A2B3C; }
        .cp-author-sub { font-size:0.75rem; color:#9ca3af; margin-top:0.1rem; text-transform:capitalize; }
        .cp-audience-pill {
          display:inline-flex; align-items:center; gap:0.35rem;
          background:#EEF4FB; border:1px solid #C5D9F1; border-radius:999px;
          padding:0.2rem 0.65rem; font-size:0.72rem; font-weight:700; color:#365F91;
          cursor:pointer; transition:all 0.12s; margin-top:0.2rem;
        }
        .cp-audience-pill:hover { background:#C5D9F1; }

        .cp-title-input {
          width:100%; border:none; font-size:1.55rem; font-weight:800;
          color:#1A2B3C; outline:none; background:transparent;
          line-height:1.25; letter-spacing:-0.02em; font-family:inherit;
          margin-bottom:0.85rem; resize:none; overflow:hidden;
        }
        .cp-title-input::placeholder { color:#e5e7eb; font-weight:600; }

        .cp-divider { border:none; border-top:1px solid #f3f4f6; margin:0.5rem 0 1rem; }

        .cp-content-textarea {
          width:100%; min-height:240px; border:none; font-size:0.96rem;
          color:#374151; outline:none; resize:none; background:transparent;
          line-height:1.75; font-family:'Source Serif 4','Cambria','Georgia',serif;
        }
        .cp-content-textarea::placeholder { color:#c4c9d4; font-family:'Nunito',sans-serif; }

        .cp-compose-footer {
          display:flex; align-items:center; justify-content:space-between;
          padding:0.9rem 1.5rem; border-top:1px solid #f3f4f6; gap:1rem; flex-wrap:wrap;
        }
        .cp-char-bar { flex:1; max-width:200px; }
        .cp-char-track { height:3px; background:#f3f4f6; border-radius:999px; overflow:hidden; margin-bottom:0.3rem; }
        .cp-char-fill { height:100%; border-radius:999px; transition:width 0.2s,background 0.2s; }
        .cp-char-label { font-size:0.7rem; color:#c4c9d4; font-weight:600; }
        .cp-char-label.warn { color:#F79646; }
        .cp-char-label.danger { color:#C0504D; }

        /* Attachment */
        .cp-attach-bar {
          border-top:1px solid #f3f4f6; padding:0.75rem 1.5rem;
          display:flex; align-items:center; gap:0.75rem; flex-wrap:wrap;
        }
        .cp-attach-label { font-size:0.72rem; font-weight:700; color:#9ca3af; text-transform:uppercase; letter-spacing:0.05em; flex-shrink:0; }
        .cp-attach-toggle {
          display:flex; align-items:center; gap:0.4rem;
          padding:0.32rem 0.85rem; border:1.5px dashed #e5e7eb; border-radius:9px;
          font-size:0.8rem; font-weight:600; color:#9ca3af; background:white;
          cursor:pointer; transition:all 0.15s; font-family:inherit;
        }
        .cp-attach-toggle:hover { border-color:#4BACC6; color:#243F60; }
        .cp-attach-input-wrap { flex:1; display:flex; align-items:center; gap:0.5rem; background:#EEF4FB; border:1.5px solid #4BACC6; border-radius:9px; padding:0.4rem 0.75rem; }
        .cp-attach-input-wrap input { flex:1; border:none; background:transparent; font-size:0.82rem; color:#374151; outline:none; font-family:inherit; }
        .cp-attach-input-wrap input::placeholder { color:#9ca3af; }
        .cp-attach-clear { background:none; border:none; color:#9ca3af; cursor:pointer; font-size:0.8rem; padding:0; transition:color 0.12s; }
        .cp-attach-clear:hover { color:#C0504D; }

        .cp-image-preview { margin:0 1.5rem 1rem; border-radius:12px; overflow:hidden; border:1px solid #e5e7eb; position:relative; background:#f9fafb; max-height:260px; }
        .cp-image-preview img { width:100%; max-height:260px; object-fit:cover; display:block; }
        .cp-preview-tag { position:absolute; top:8px; left:8px; background:rgba(0,0,0,0.55); color:white; font-size:0.65rem; font-weight:700; padding:0.18rem 0.5rem; border-radius:6px; letter-spacing:0.06em; }

        /* ── Settings step ── */
        .cp-settings-body { padding:0; }
        .cp-settings-section { padding:1.35rem 1.5rem; border-bottom:1px solid #f3f4f6; }
        .cp-settings-section:last-child { border-bottom:none; }
        .cp-settings-section-title { font-size:0.72rem; font-weight:700; color:#9ca3af; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:1rem; display:flex; align-items:center; gap:0.5rem; }
        .cp-settings-section-icon { font-size:0.85rem; }

        .cp-audience-grid { display:grid; grid-template-columns:1fr 1fr; gap:0.6rem; }
        .cp-audience-card {
          border:2px solid #e5e7eb; border-radius:12px; padding:1.1rem;
          cursor:pointer; transition:all 0.15s; background:white; text-align:left;
          display:flex; flex-direction:column; gap:0.4rem; font-family:inherit;
        }
        .cp-audience-card:hover { border-color:#4BACC6; background:#f8fbff; }
        .cp-audience-card.selected { border-color:#4BACC6; background:#EEF4FB; }
        .cp-audience-card-icon { font-size:1.5rem; }
        .cp-audience-card-label { font-size:0.88rem; font-weight:700; color:#1A2B3C; }
        .cp-audience-card.selected .cp-audience-card-label { color:#243F60; }
        .cp-audience-card-desc { font-size:0.72rem; color:#9ca3af; line-height:1.4; }
        .cp-audience-card-check { width:18px; height:18px; border-radius:50%; border:2px solid #e5e7eb; margin-left:auto; display:flex; align-items:center; justify-content:center; font-size:0.65rem; color:white; flex-shrink:0; align-self:flex-start; }
        .cp-audience-card.selected .cp-audience-card-check { background:#4BACC6; border-color:#4BACC6; }

        .cp-select { width:100%; padding:0.65rem 0.85rem; border:1.5px solid #e5e7eb; border-radius:10px; font-size:0.88rem; background:white; color:#374151; font-family:inherit; outline:none; margin-top:0.75rem; }
        .cp-select:focus { border-color:#4BACC6; box-shadow:0 0 0 3px rgba(75,172,198,0.1); }

        .cp-type-grid { display:grid; grid-template-columns:1fr 1fr; gap:0.6rem; }
        .cp-type-card {
          border:2px solid #e5e7eb; border-radius:12px; padding:1rem;
          cursor:pointer; transition:all 0.15s; background:white; text-align:left;
          display:flex; align-items:flex-start; gap:0.75rem; font-family:inherit;
        }
        .cp-type-card:hover { border-color:#4BACC6; }
        .cp-type-card.selected.ann { border-color:#4F81BD; background:#EEF4FB; }
        .cp-type-card.selected.event { border-color:#8064A2; background:#F3EEF9; }
        .cp-type-card-icon { font-size:1.25rem; flex-shrink:0; margin-top:0.1rem; }
        .cp-type-card-label { font-size:0.85rem; font-weight:700; color:#374151; display:block; }
        .cp-type-card.selected .cp-type-card-label { color:#243F60; }
        .cp-type-card-desc { font-size:0.72rem; color:#9ca3af; display:block; margin-top:0.15rem; }

        .cp-event-dates { display:grid; grid-template-columns:1fr 1fr; gap:0.75rem; margin-top:1rem; }
        .cp-date-field label { display:block; font-size:0.72rem; font-weight:700; color:#9ca3af; margin-bottom:0.3rem; text-transform:uppercase; letter-spacing:0.05em; }
        .cp-date-field input { width:100%; padding:0.6rem 0.85rem; border:1.5px solid #e5e7eb; border-radius:10px; font-size:0.85rem; color:#374151; background:white; box-sizing:border-box; font-family:inherit; outline:none; }
        .cp-date-field input:focus { border-color:#4BACC6; }

        .cp-mustread-row { display:flex; align-items:flex-start; justify-content:space-between; gap:1.25rem; }
        .cp-mustread-text .cp-mustread-label { font-size:0.9rem; font-weight:700; color:#374151; display:block; margin-bottom:0.2rem; }
        .cp-mustread-text .cp-mustread-desc { font-size:0.78rem; color:#9ca3af; line-height:1.55; }
        .cp-toggle { position:relative; width:44px; height:24px; flex-shrink:0; margin-top:0.1rem; }
        .cp-toggle input { opacity:0; width:0; height:0; }
        .cp-toggle-track { position:absolute; inset:0; border-radius:999px; background:#e5e7eb; cursor:pointer; transition:background 0.2s; }
        .cp-toggle input:checked + .cp-toggle-track { background:#4BACC6; }
        .cp-toggle-track::after { content:''; position:absolute; left:3px; top:3px; width:18px; height:18px; border-radius:50%; background:white; transition:transform 0.2s; box-shadow:0 1px 3px rgba(0,0,0,0.15); }
        .cp-toggle input:checked + .cp-toggle-track::after { transform:translateX(20px); }

        /* ── Preview step ── */
        .cp-preview-post { animation:fadeIn 0.3s ease; }
        .cp-preview-header { padding:1.5rem; border-bottom:1px solid #f3f4f6; }
        .cp-preview-author-row { display:flex; align-items:center; gap:0.75rem; margin-bottom:1rem; }
        .cp-preview-avatar { width:42px; height:42px; border-radius:50%; background:linear-gradient(135deg,#4BACC6,#243F60); color:white; font-size:0.95rem; font-weight:800; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        .cp-preview-author-name { font-size:0.9rem; font-weight:700; color:#1A2B3C; }
        .cp-preview-author-sub { font-size:0.73rem; color:#9ca3af; margin-top:0.1rem; }
        .cp-preview-badges { display:flex; gap:0.4rem; flex-wrap:wrap; }
        .cp-preview-badge { font-size:0.65rem; font-weight:700; padding:0.2rem 0.6rem; border-radius:4px; letter-spacing:0.06em; text-transform:uppercase; }
        .cp-preview-badge.ann { background:#EEF4FB; color:#365F91; border:1px solid #C5D9F1; }
        .cp-preview-badge.event { background:#F3EEF9; color:#8064A2; border:1px solid #D9CCF0; }
        .cp-preview-badge.must { background:#FEF2F2; color:#C0504D; border:1px solid #F4BDBB; }
        .cp-preview-badge.global { background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0; }
        .cp-preview-badge.dept { background:#EEF4FB; color:#365F91; border:1px solid #C5D9F1; }
        .cp-preview-body { padding:1.5rem; }
        .cp-preview-title { font-size:1.55rem; font-weight:800; color:#1A2B3C; margin-bottom:1rem; line-height:1.25; letter-spacing:-0.02em; }
        .cp-preview-ai { display:flex; align-items:flex-start; gap:0.5rem; background:#EEF4FB; border:1px solid #C5D9F1; border-radius:9px; padding:0.75rem 1rem; margin-bottom:1.1rem; font-size:0.82rem; color:#365F91; line-height:1.55; }
        .cp-preview-content { font-size:0.96rem; color:#374151; line-height:1.8; white-space:pre-wrap; word-break:break-word; font-family:'Source Serif 4','Cambria','Georgia',serif; }
        .cp-preview-image { margin-top:1.25rem; border-radius:12px; overflow:hidden; border:1px solid #e5e7eb; }
        .cp-preview-image img { width:100%; max-height:320px; object-fit:cover; display:block; }
        .cp-preview-event-card { display:flex; align-items:center; gap:0.75rem; background:#f3eeff; border:1px solid #D9CCF0; border-radius:11px; padding:0.85rem 1.1rem; margin-top:1.25rem; }
        .cp-preview-event-icon { font-size:1.3rem; flex-shrink:0; }
        .cp-preview-event-date { font-size:0.88rem; font-weight:700; color:#8064A2; }
        .cp-preview-event-time { font-size:0.78rem; color:#9ca3af; margin-top:0.1rem; }

        /* ── Sidebar ── */
        .cp-sidebar { display:flex; flex-direction:column; gap:1rem; position:sticky; top:112px; }

        .cp-sidebar-card { background:white; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; }
        .cp-sidebar-header { padding:0.85rem 1.1rem; border-bottom:1px solid #f3f4f6; display:flex; align-items:center; gap:0.5rem; }
        .cp-sidebar-header-icon { width:26px; height:26px; border-radius:7px; background:#EEF4FB; display:flex; align-items:center; justify-content:center; font-size:0.8rem; flex-shrink:0; }
        .cp-sidebar-title { font-size:0.75rem; font-weight:700; color:#374151; text-transform:uppercase; letter-spacing:0.06em; }
        .cp-sidebar-body { padding:1rem 1.1rem; }

        .cp-summary-row { display:flex; align-items:flex-start; justify-content:space-between; gap:0.5rem; padding:0.45rem 0; border-bottom:1px solid #f9fafb; }
        .cp-summary-row:last-child { border-bottom:none; }
        .cp-summary-label { font-size:0.75rem; color:#9ca3af; font-weight:600; flex-shrink:0; }
        .cp-summary-value { font-size:0.78rem; font-weight:700; color:#374151; text-align:right; }

        .cp-checklist-item { display:flex; align-items:center; gap:0.55rem; padding:0.4rem 0; }
        .cp-checklist-icon { font-size:0.85rem; flex-shrink:0; width:18px; text-align:center; }
        .cp-checklist-text { font-size:0.8rem; color:#374151; }
        .cp-checklist-text.muted { color:#9ca3af; text-decoration:line-through; }

        /* ── Actions ── */
        .cp-actions { display:flex; align-items:center; justify-content:space-between; gap:0.75rem; padding:1.25rem 1.5rem; background:white; border:1px solid #e5e7eb; border-radius:14px; margin-top:0; }
        .cp-actions-left { display:flex; align-items:center; gap:0.6rem; }
        .cp-actions-right { display:flex; align-items:center; gap:0.6rem; }

        .btn-ghost { padding:0.55rem 1.1rem; background:transparent; border:1px solid #e5e7eb; border-radius:9px; font-size:0.85rem; font-weight:600; color:#6b7280; cursor:pointer; transition:all 0.15s; font-family:inherit; }
        .btn-ghost:hover { background:#f9fafb; border-color:#d1d5db; color:#374151; }

        .btn-outline-blue { padding:0.55rem 1.25rem; background:white; border:1.5px solid #4F81BD; border-radius:9px; font-size:0.85rem; font-weight:700; color:#365F91; cursor:pointer; transition:all 0.15s; font-family:inherit; display:flex; align-items:center; gap:0.4rem; }
        .btn-outline-blue:hover { background:#EEF4FB; }
        .btn-outline-blue:disabled { opacity:0.4; cursor:not-allowed; }

        .btn-publish { display:flex; align-items:center; gap:0.5rem; padding:0.65rem 1.75rem; background:linear-gradient(135deg,#365F91,#243F60); color:white; border:none; border-radius:10px; font-size:0.9rem; font-weight:700; cursor:pointer; transition:all 0.15s; font-family:inherit; box-shadow:0 4px 12px rgba(36,63,96,0.25); }
        .btn-publish:hover:not(:disabled) { filter:brightness(1.1); transform:translateY(-1px); box-shadow:0 6px 18px rgba(36,63,96,0.35); }
        .btn-publish:active { transform:translateY(0); }
        .btn-publish:disabled { opacity:0.45; cursor:not-allowed; box-shadow:none; transform:none; }

        .cp-error { display:flex; align-items:center; gap:0.5rem; background:#FDECEA; border:1px solid #F4BDBB; border-radius:10px; padding:0.75rem 1rem; color:#C0504D; font-size:0.85rem; font-weight:500; margin-bottom:1rem; }

        @media(max-width:900px) {
          .cp-body { grid-template-columns:1fr; }
          .cp-sidebar { position:static; }
          .cp-audience-grid,.cp-type-grid { grid-template-columns:1fr; }
          .cp-event-dates { grid-template-columns:1fr; }
        }
        @media(max-width:640px) {
          .cp-body { padding:1rem 0.85rem 3rem; }
          .cp-compose-body { padding:1.25rem; }
          .cp-title-input { font-size:1.25rem; }
          .cp-progress { padding:0 0.85rem; }
        }
      `}</style>

      <div className="cp-page">
        <Navbar fullName={profile?.full_name ?? null} role={profile?.role ?? 'employee'} />

        {/* Progress steps */}
        <div className="cp-progress">
          {([
            { id: 'compose',  label: 'Write',    n: 1 },
            { id: 'settings', label: 'Settings', n: 2 },
            { id: 'preview',  label: 'Preview',  n: 3 },
          ] as const).map((s, i) => {
            const isDone = (s.id === 'compose' && (step === 'settings' || step === 'preview')) || (s.id === 'settings' && step === 'preview')
            const isActive = step === s.id
            const isDisabled = s.id === 'settings' && !canProceedToSettings()
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center' }}>
                {i > 0 && <div className="cp-step-arrow">›</div>}
                <button
                  className={`cp-step${isActive ? ' active' : ''}${isDone ? ' done' : ''}${isDisabled ? ' disabled' : ''}`}
                  onClick={() => !isDisabled && setStep(s.id)}
                >
                  <div className="cp-step-num">{isDone ? '✓' : s.n}</div>
                  {s.label}
                </button>
              </div>
            )
          })}
        </div>

        <div className="cp-body">
          <div>
            {error && <div className="cp-error"><span>⚠</span> {error}</div>}

            {/* ── COMPOSE ── */}
            {step === 'compose' && (
              <div className="cp-panel">
                <div className="cp-card">
                  {/* Type toggles */}
                  <div className="cp-compose-topbar">
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#c4c9d4', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Post type</span>
                    <button className={`cp-type-pill ann${postType === 'announcement' ? ' active' : ''}`} onClick={() => setPostType('announcement')}>
                      📢 Announcement
                    </button>
                    <button className={`cp-type-pill event${postType === 'news_event' ? ' active' : ''}`} onClick={() => setPostType('news_event')}>
                      📅 Event
                    </button>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 600 }}>Must-read</span>
                      <label className="cp-toggle">
                        <input type="checkbox" checked={mustRead} onChange={e => setMustRead(e.target.checked)} />
                        <span className="cp-toggle-track" />
                      </label>
                    </div>
                  </div>

                  {/* Author + editor */}
                  <div className="cp-compose-body">
                    <div className="cp-author-row">
                      <div className="cp-author-avatar">{initials}</div>
                      <div>
                        <div className="cp-author-name">{profile?.full_name ?? 'You'}</div>
                        <div className="cp-author-sub">{profile?.role}</div>
                        <button className="cp-audience-pill" onClick={() => setStep('settings')}>
                          {audience === 'global' ? '🌐' : '🏢'} Posting to: {audienceLabel} ›
                        </button>
                      </div>
                    </div>

                    <input
                      ref={titleRef}
                      className="cp-title-input"
                      placeholder="Give your post a title…"
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      maxLength={120}
                    />
                    <hr className="cp-divider" />
                    <textarea
                      ref={contentRef}
                      className="cp-content-textarea"
                      placeholder="What do you want to share with the team? Write as much as you need…"
                      value={content}
                      onChange={e => {
                        if (e.target.value.length > MAX_CHARS) return
                        setContent(e.target.value)
                        e.target.style.height = 'auto'
                        e.target.style.height = e.target.scrollHeight + 'px'
                      }}
                    />
                  </div>

                  {/* Attachment row */}
                  <div className="cp-attach-bar">
                    <span className="cp-attach-label">Attachment</span>
                    {!showAttachment ? (
                      <button className="cp-attach-toggle" onClick={() => setShowAttachment(true)}>
                        <span>🖼</span> Add image URL
                      </button>
                    ) : (
                      <div className="cp-attach-input-wrap">
                        <span style={{ fontSize: '0.85rem', flexShrink: 0 }}>🔗</span>
                        <input
                          placeholder="https://example.com/image.jpg"
                          value={attachmentUrl}
                          onChange={e => { setAttachmentUrl(e.target.value); setAttachPreviewOk(false) }}
                          autoFocus
                        />
                        <button className="cp-attach-clear" onClick={() => { setAttachmentUrl(''); setShowAttachment(false); setAttachPreviewOk(false) }}>✕</button>
                      </div>
                    )}
                  </div>

                  {attachmentUrl.trim() && (
                    <div className="cp-image-preview">
                      <img
                        src={attachmentUrl.trim()} alt="Preview"
                        onLoad={() => setAttachPreviewOk(true)}
                        onError={() => setAttachPreviewOk(false)}
                        style={{ display: attachPreviewOk ? 'block' : 'none' }}
                      />
                      {!attachPreviewOk && <div style={{ padding: '1rem', color: '#9ca3af', fontSize: '0.8rem', textAlign: 'center' }}>⏳ Loading preview…</div>}
                      {attachPreviewOk && <span className="cp-preview-tag">PREVIEW</span>}
                    </div>
                  )}

                  {/* Footer */}
                  <div className="cp-compose-footer">
                    <div className="cp-char-bar">
                      <div className="cp-char-track">
                        <div className="cp-char-fill" style={{
                          width: `${charPct}%`,
                          background: charPct > 90 ? '#C0504D' : charPct > 70 ? '#F79646' : '#4BACC6',
                        }} />
                      </div>
                      <div className={`cp-char-label${charPct > 90 ? ' danger' : charPct > 70 ? ' warn' : ''}`}>
                        {charCount} / {MAX_CHARS} chars · {wordCount} words
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.6rem' }}>
                      <button className="btn-ghost" onClick={() => navigate('/dashboard')}>Discard</button>
                      <button
                        className="btn-outline-blue"
                        onClick={() => setStep('settings')}
                        disabled={!canProceedToSettings()}
                      >
                        Settings →
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── SETTINGS ── */}
            {step === 'settings' && (
              <div className="cp-panel" style={{ animation: 'slideRight 0.25s ease' }}>
                <div className="cp-card">
                  <div className="cp-settings-body">

                    {/* Audience */}
                    <div className="cp-settings-section">
                      <div className="cp-settings-section-title">
                        <span className="cp-settings-section-icon">📣</span>
                        Who should see this post?
                      </div>
                      <div className="cp-audience-grid">
                        <button className={`cp-audience-card${audience === 'global' ? ' selected' : ''}`} onClick={() => setAudience('global')}>
                          <div className="cp-audience-card-check">{audience === 'global' ? '✓' : ''}</div>
                          <div className="cp-audience-card-icon">🌐</div>
                          <span className="cp-audience-card-label">Everyone</span>
                          <span className="cp-audience-card-desc">Visible to all staff across all departments</span>
                        </button>
                        <button className={`cp-audience-card${audience === 'department' ? ' selected' : ''}`} onClick={() => setAudience('department')}>
                          <div className="cp-audience-card-check">{audience === 'department' ? '✓' : ''}</div>
                          <div className="cp-audience-card-icon">🏢</div>
                          <span className="cp-audience-card-label">Department only</span>
                          <span className="cp-audience-card-desc">Only visible to members of one department</span>
                        </button>
                      </div>
                      {audience === 'department' && (
                        <select className="cp-select" value={selectedDeptId} onChange={e => setSelectedDeptId(e.target.value)}>
                          <option value="">Choose a department…</option>
                          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      )}
                    </div>

                    {/* Post type */}
                    <div className="cp-settings-section">
                      <div className="cp-settings-section-title">
                        <span className="cp-settings-section-icon">📌</span>
                        Post type
                      </div>
                      <div className="cp-type-grid">
                        <button className={`cp-type-card${postType === 'announcement' ? ' selected ann' : ''}`} onClick={() => setPostType('announcement')}>
                          <span className="cp-type-card-icon">📢</span>
                          <span>
                            <span className="cp-type-card-label">Announcement</span>
                            <span className="cp-type-card-desc">A general notice, policy update, or information post</span>
                          </span>
                        </button>
                        <button className={`cp-type-card${postType === 'news_event' ? ' selected event' : ''}`} onClick={() => setPostType('news_event')}>
                          <span className="cp-type-card-icon">📅</span>
                          <span>
                            <span className="cp-type-card-label">News & Event</span>
                            <span className="cp-type-card-desc">A scheduled event with a specific date and time</span>
                          </span>
                        </button>
                      </div>

                      {postType === 'news_event' && (
                        <div className="cp-event-dates">
                          <div className="cp-date-field">
                            <label>Start date & time</label>
                            <input type="datetime-local" value={eventStart} onChange={e => setEventStart(e.target.value)} />
                          </div>
                          <div className="cp-date-field">
                            <label>End date & time</label>
                            <input type="datetime-local" value={eventEnd} onChange={e => setEventEnd(e.target.value)} />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Must read */}
                    <div className="cp-settings-section">
                      <div className="cp-settings-section-title">
                        <span className="cp-settings-section-icon">⚠</span>
                        Acknowledgement
                      </div>
                      <div className="cp-mustread-row">
                        <div className="cp-mustread-text">
                          <span className="cp-mustread-label">Require must-read acknowledgement</span>
                          <span className="cp-mustread-desc">Staff must tap "Mark as read" before this post clears from their dashboard. Use for important policies, safety notices or mandatory reading.</span>
                        </div>
                        <label className="cp-toggle">
                          <input type="checkbox" checked={mustRead} onChange={e => setMustRead(e.target.checked)} />
                          <span className="cp-toggle-track" />
                        </label>
                      </div>
                    </div>

                  </div>
                </div>

                <div className="cp-actions">
                  <div className="cp-actions-left">
                    <button className="btn-ghost" onClick={() => setStep('compose')}>← Back</button>
                  </div>
                  <div className="cp-actions-right">
                    <button className="btn-outline-blue" onClick={() => setStep('preview')}>
                      Preview post →
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── PREVIEW ── */}
            {step === 'preview' && (
              <div className="cp-panel">
                <p style={{ fontSize: '0.78rem', color: '#9ca3af', fontWeight: 600, marginBottom: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span>👁</span> This is exactly how your post will appear on the dashboard.
                </p>

                <div className="cp-card cp-preview-post">
                  <div className="cp-preview-header">
                    <div className="cp-preview-author-row">
                      <div className="cp-preview-avatar">{initials}</div>
                      <div>
                        <div className="cp-preview-author-name">{profile?.full_name ?? 'You'}</div>
                        <div className="cp-preview-author-sub">{profile?.role} · just now</div>
                      </div>
                    </div>
                    <div className="cp-preview-badges">
                      <span className={`cp-preview-badge ${postType === 'announcement' ? 'ann' : 'event'}`}>
                        {postType === 'announcement' ? 'Announcement' : 'Event'}
                      </span>
                      {mustRead && <span className="cp-preview-badge must">⚠ Must-read</span>}
                      {audience === 'global'
                        ? <span className="cp-preview-badge global">🌐 Everyone</span>
                        : <span className="cp-preview-badge dept">🏢 {audienceDept?.name ?? 'Department'}</span>}
                    </div>
                  </div>

                  <div className="cp-preview-body">
                    <h2 className="cp-preview-title">{title || '(No title)'}</h2>

                    {content.trim().length > 60 && (
                      <div className="cp-preview-ai">
                        <span style={{ color: '#4BACC6', flexShrink: 0 }}>✦</span>
                        <span>
                          <strong style={{ marginRight: '0.3rem' }}>AI Summary —</strong>
                          {content.trim().slice(0, 140).replace(/\s+\S*$/, '') + (content.length > 140 ? '…' : '')}
                        </span>
                      </div>
                    )}

                    <p className="cp-preview-content">{content || '(No content)'}</p>

                    {postType === 'news_event' && (eventStart || eventEnd) && (
                      <div className="cp-preview-event-card">
                        <span className="cp-preview-event-icon">📅</span>
                        <div>
                          {eventStart && <div className="cp-preview-event-date">{new Date(eventStart).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>}
                          <div className="cp-preview-event-time">
                            {eventStart && new Date(eventStart).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true })}
                            {eventEnd && ` – ${new Date(eventEnd).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true })}`}
                          </div>
                        </div>
                      </div>
                    )}

                    {attachmentUrl.trim() && attachPreviewOk && (
                      <div className="cp-preview-image">
                        <img src={attachmentUrl.trim()} alt="" loading="lazy" />
                      </div>
                    )}
                  </div>
                </div>

                <div className="cp-actions" style={{ marginTop: '1rem' }}>
                  <div className="cp-actions-left">
                    <button className="btn-ghost" onClick={() => setStep('settings')}>← Edit settings</button>
                    <button className="btn-ghost" onClick={() => setStep('compose')}>✎ Edit content</button>
                  </div>
                  <div className="cp-actions-right">
                    <button className="btn-publish" onClick={handlePublish} disabled={submitting}>
                      {submitting ? '⏳ Publishing…' : '✓ Publish post'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Sidebar ── */}
          <div className="cp-sidebar">

            {/* Post summary */}
            <div className="cp-sidebar-card">
              <div className="cp-sidebar-header">
                <div className="cp-sidebar-header-icon">📋</div>
                <span className="cp-sidebar-title">Post summary</span>
              </div>
              <div className="cp-sidebar-body">
                {[
                  { label: 'Type', value: postType === 'announcement' ? '📢 Announcement' : '📅 Event' },
                  { label: 'Audience', value: audience === 'global' ? '🌐 Everyone' : audienceDept ? `🏢 ${audienceDept.name}` : '— Select dept' },
                  { label: 'Must-read', value: mustRead ? '⚠ Yes' : '— No' },
                  { label: 'Words', value: `${wordCount}` },
                  { label: 'Characters', value: `${charCount} / ${MAX_CHARS}` },
                  ...(attachmentUrl.trim() ? [{ label: 'Attachment', value: '🖼 Added' }] : []),
                  ...(postType === 'news_event' && eventStart ? [{ label: 'Event date', value: new Date(eventStart).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) }] : []),
                ].map(row => (
                  <div key={row.label} className="cp-summary-row">
                    <span className="cp-summary-label">{row.label}</span>
                    <span className="cp-summary-value">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Readiness checklist */}
            <div className="cp-sidebar-card">
              <div className="cp-sidebar-header">
                <div className="cp-sidebar-header-icon">✅</div>
                <span className="cp-sidebar-title">Readiness check</span>
              </div>
              <div className="cp-sidebar-body">
                {[
                  { icon: title.trim() ? '✅' : '⭕', text: 'Title added', done: !!title.trim() },
                  { icon: content.trim() ? '✅' : '⭕', text: 'Content written', done: !!content.trim() },
                  { icon: audience !== 'department' || selectedDeptId ? '✅' : '⭕', text: 'Audience selected', done: audience !== 'department' || !!selectedDeptId },
                  { icon: postType !== 'news_event' || eventStart ? '✅' : '⭕', text: 'Event date set', done: postType !== 'news_event' || !!eventStart },
                ].filter(i => postType === 'news_event' || i.text !== 'Event date set').map(item => (
                  <div key={item.text} className="cp-checklist-item">
                    <span className="cp-checklist-icon">{item.icon}</span>
                    <span className={`cp-checklist-text${item.done ? '' : ' muted'}`}>{item.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Tips */}
            <div className="cp-sidebar-card">
              <div className="cp-sidebar-header">
                <div className="cp-sidebar-header-icon">💡</div>
                <span className="cp-sidebar-title">Writing tips</span>
              </div>
              <div className="cp-sidebar-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {[
                  { icon: '🎯', tip: 'Lead with the most important information in the first sentence.' },
                  { icon: '⚠', tip: 'Only mark as must-read for critical or compliance content.' },
                  { icon: '📅', tip: 'Use the Event type for meetings, deadlines or scheduled activities.' },
                ].map(t => (
                  <div key={t.tip} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '0.85rem', flexShrink: 0, marginTop: '0.05rem' }}>{t.icon}</span>
                    <span style={{ fontSize: '0.75rem', color: '#6b7280', lineHeight: 1.55 }}>{t.tip}</span>
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