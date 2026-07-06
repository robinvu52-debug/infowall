import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Navbar from '../components/Navbar'

interface Profile {
  id: string
  full_name: string | null
  role: string
  department_id: string | null
}

interface Department {
  id: string
  name: string
}

type Audience = 'global' | 'department' | 'personal'
type PostType = 'announcement' | 'news_event'

function CreatePostPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [allProfiles, setAllProfiles] = useState<Profile[]>([])
  const [userId, setUserId] = useState<string | null>(null)

  const [audience, setAudience] = useState<Audience>('global')
  const [selectedDeptId, setSelectedDeptId] = useState('')
  const [selectedRecipient, setSelectedRecipient] = useState<Profile | null>(null)
  const [userSearchQuery, setUserSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [postType, setPostType] = useState<PostType>('announcement')
  const [mustRead, setMustRead] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [eventStart, setEventStart] = useState('')
  const [eventEnd, setEventEnd] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const searchRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { navigate('/login'); return }
      setUserId(user.id)

      const { data: p } = await supabase
        .from('profiles').select('*').eq('id', user.id).single()
      if (!p || !['hr', 'manager', 'admin'].includes(p.role)) {
        navigate('/dashboard'); return
      }
      setProfile(p)

      const [{ data: ds }, { data: ps }] = await Promise.all([
        supabase.from('departments').select('*').order('name'),
        supabase.from('profiles').select('*').order('full_name'),
      ])

      setDepartments(ds ?? [])
      setAllProfiles((ps ?? []).filter(pr => pr.id !== user.id))

      // Pre-fill recipient if coming from a profile "Send message" button
      const state = location.state as { recipientId?: string; recipientName?: string } | null
      if (state?.recipientId && state?.recipientName) {
        setAudience('personal')
        setSelectedRecipient({
          id: state.recipientId,
          full_name: state.recipientName,
          role: '',
          department_id: null,
        })
      }
    }

    load()

    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [navigate, location.state])

  const filteredUsers = allProfiles.filter(p =>
    userSearchQuery.trim() === '' ||
    p.full_name?.toLowerCase().includes(userSearchQuery.toLowerCase())
  )

  async function handleSubmit() {
    if (!title.trim()) { setError('Please add a title.'); return }
    if (!content.trim()) { setError('Please add some content.'); return }
    if (audience === 'department' && !selectedDeptId) { setError('Please select a department.'); return }
    if (audience === 'personal' && !selectedRecipient) { setError('Please select a recipient.'); return }

    setSubmitting(true)
    setError(null)

    const payload: Record<string, unknown> = {
      author_id: userId,
      title: title.trim(),
      content: content.trim(),
      post_type: postType,
      must_read: mustRead,
      department_id: audience === 'department' ? selectedDeptId : null,
      recipient_id: audience === 'personal' ? selectedRecipient?.id : null,
      event_start: postType === 'news_event' && eventStart ? eventStart : null,
      event_end: postType === 'news_event' && eventEnd ? eventEnd : null,
    }

    const { error: insertError } = await supabase.from('posts').insert(payload)

    if (insertError) {
      setError(insertError.message)
      setSubmitting(false)
      return
    }

    navigate('/dashboard')
  }

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length
  const canSubmit = title.trim().length > 0 && content.trim().length > 0 && !submitting

  return (
    <>
      <style>{`
        .cp-page { min-height: 100vh; background: #f0f2f5; }

        .cp-body {
          max-width: 720px;
          margin: 0 auto;
          padding: 2rem 1.5rem 4rem;
        }

        .cp-page-header { margin-bottom: 2rem; }

        .cp-back-btn {
          display: inline-flex; align-items: center; gap: 0.4rem;
          background: none; border: none; color: #6b7280;
          font-size: 0.82rem; font-weight: 500; cursor: pointer;
          padding: 0; margin-bottom: 0.85rem; transition: color 0.12s;
        }
        .cp-back-btn:hover { color: #0d2d3a; }

        .cp-page-title {
          font-size: 1.5rem; font-weight: 800;
          color: #0d2d3a; margin: 0 0 0.25rem;
          letter-spacing: -0.02em;
        }

        .cp-page-sub { font-size: 0.85rem; color: #9ca3af; margin: 0; }

        /* Cards */
        .cp-card {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          overflow: visible;
          margin-bottom: 1rem;
        }

        .cp-card-header {
          padding: 1rem 1.4rem;
          border-bottom: 1px solid #f3f4f6;
          display: flex; align-items: center; gap: 0.65rem;
        }

        .cp-card-icon {
          width: 28px; height: 28px; border-radius: 8px;
          background: #f0fdfa;
          display: flex; align-items: center; justify-content: center;
          font-size: 0.85rem; flex-shrink: 0;
        }

        .cp-card-title {
          font-size: 0.78rem; font-weight: 700;
          color: #374151; text-transform: uppercase;
          letter-spacing: 0.06em; margin: 0;
        }

        .cp-card-body { padding: 1.25rem 1.4rem; }

        /* Audience */
        .audience-options {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.6rem;
        }

        .audience-option {
          display: flex; flex-direction: column; align-items: center;
          gap: 0.4rem; padding: 1rem 0.5rem;
          border: 2px solid #e5e7eb; border-radius: 12px;
          background: white; cursor: pointer;
          transition: all 0.15s; text-align: center;
        }
        .audience-option:hover { border-color: #00b8b8; background: #f0fdfa; }
        .audience-option.selected { border-color: #00b8b8; background: #f0fdfa; }

        .audience-option-icon { font-size: 1.4rem; }

        .audience-option-label {
          font-size: 0.82rem; font-weight: 700; color: #374151;
        }
        .audience-option.selected .audience-option-label { color: #0f766e; }

        .audience-option-desc { font-size: 0.7rem; color: #9ca3af; line-height: 1.3; }

        .audience-sub {
          margin-top: 1rem; padding-top: 1rem;
          border-top: 1px solid #f3f4f6;
        }

        .sub-label {
          font-size: 0.75rem; font-weight: 700;
          color: #6b7280; margin-bottom: 0.5rem;
          display: block; text-transform: uppercase; letter-spacing: 0.05em;
        }

        .cp-select {
          width: 100%; padding: 0.6rem 0.85rem;
          border: 1px solid #e5e7eb; border-radius: 9px;
          font-size: 0.88rem; background: white; color: #374151;
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%236b7280' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 0.85rem center;
          cursor: pointer; box-sizing: border-box;
        }
        .cp-select:focus { outline: none; border-color: #00b8b8; box-shadow: 0 0 0 3px rgba(0,184,184,0.1); }

        /* User search */
        .user-search-wrap { position: relative; }

        .user-search-input-row {
          display: flex; align-items: center; gap: 0.5rem;
          padding: 0.55rem 0.85rem;
          border: 1px solid #e5e7eb; border-radius: 9px;
          background: white; transition: border-color 0.12s;
          min-height: 42px;
        }
        .user-search-input-row:focus-within { border-color: #00b8b8; box-shadow: 0 0 0 3px rgba(0,184,184,0.1); }

        .user-search-input-row input {
          flex: 1; border: none; background: transparent;
          font-size: 0.88rem; color: #374151; outline: none;
        }
        .user-search-input-row input::placeholder { color: #9ca3af; }

        .selected-chip {
          display: flex; align-items: center; gap: 0.45rem;
          background: #f0fdfa; border: 1px solid #ccfbf1;
          border-radius: 999px; padding: 0.2rem 0.6rem 0.2rem 0.35rem;
        }

        .chip-avatar {
          width: 22px; height: 22px; border-radius: 50%;
          background: linear-gradient(135deg, #00b8b8, #0d2d3a);
          color: white; font-size: 0.62rem; font-weight: 700;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }

        .chip-name { font-size: 0.8rem; font-weight: 600; color: #0f766e; }

        .chip-remove {
          background: none; border: none; color: #9ca3af;
          cursor: pointer; font-size: 0.72rem; padding: 0;
          line-height: 1; transition: color 0.12s;
        }
        .chip-remove:hover { color: #dc2626; }

        .user-dropdown {
          position: absolute; top: calc(100% + 6px);
          left: 0; right: 0;
          background: white; border: 1px solid #e5e7eb;
          border-radius: 11px;
          box-shadow: 0 8px 28px rgba(0,0,0,0.1);
          z-index: 100; max-height: 240px; overflow-y: auto;
        }

        .user-dropdown-item {
          display: flex; align-items: center; gap: 0.7rem;
          padding: 0.7rem 0.9rem; cursor: pointer;
          transition: background 0.1s;
          border-bottom: 1px solid #f9fafb;
        }
        .user-dropdown-item:last-child { border-bottom: none; }
        .user-dropdown-item:hover { background: #f0fdfa; }

        .user-dropdown-avatar {
          width: 32px; height: 32px; border-radius: 50%;
          background: linear-gradient(135deg, #00b8b8, #0d2d3a);
          color: white; font-size: 0.75rem; font-weight: 700;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }

        .user-dropdown-name { font-size: 0.85rem; font-weight: 600; color: #374151; display: block; }
        .user-dropdown-dept { font-size: 0.72rem; color: #9ca3af; display: block; margin-top: 0.05rem; }

        .user-dropdown-empty {
          padding: 1.5rem; text-align: center;
          color: #9ca3af; font-size: 0.85rem;
        }

        /* Content */
        .cp-title-input {
          width: 100%; border: none;
          font-size: 1.35rem; font-weight: 700;
          color: #0d2d3a; outline: none;
          box-sizing: border-box; background: transparent;
          line-height: 1.3; letter-spacing: -0.01em;
        }
        .cp-title-input::placeholder { color: #e5e7eb; }

        .cp-divider { border: none; border-top: 1px solid #f3f4f6; margin: 0.85rem 0; }

        .cp-content-textarea {
          width: 100%; min-height: 180px; border: none;
          font-size: 0.92rem; color: #374151; outline: none;
          resize: none; box-sizing: border-box;
          background: transparent; line-height: 1.72;
          font-family: inherit;
        }
        .cp-content-textarea::placeholder { color: #e5e7eb; }

        .cp-word-count {
          font-size: 0.72rem; color: #e5e7eb;
          text-align: right; padding-top: 0.5rem;
        }

        /* Post type */
        .type-options { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }

        .type-option {
          display: flex; align-items: center; gap: 0.7rem;
          padding: 0.9rem 1rem; border: 2px solid #e5e7eb;
          border-radius: 11px; background: white;
          cursor: pointer; transition: all 0.15s; text-align: left;
        }
        .type-option:hover { border-color: #00b8b8; }
        .type-option.selected { border-color: #00b8b8; background: #f0fdfa; }

        .type-option-icon { font-size: 1.15rem; flex-shrink: 0; }
        .type-option-label { font-size: 0.85rem; font-weight: 700; color: #374151; display: block; }
        .type-option.selected .type-option-label { color: #0f766e; }
        .type-option-desc { font-size: 0.72rem; color: #9ca3af; display: block; margin-top: 0.1rem; }

        /* Event dates */
        .event-dates {
          display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;
          margin-top: 1rem; padding-top: 1rem;
          border-top: 1px solid #f3f4f6;
        }

        .date-field label {
          display: block; font-size: 0.72rem; font-weight: 700;
          color: #9ca3af; margin-bottom: 0.35rem;
          text-transform: uppercase; letter-spacing: 0.05em;
        }

        .date-field input {
          width: 100%; padding: 0.55rem 0.8rem;
          border: 1px solid #e5e7eb; border-radius: 8px;
          font-size: 0.82rem; color: #374151; background: white;
          box-sizing: border-box;
        }
        .date-field input:focus { outline: none; border-color: #00b8b8; }

        /* Must read */
        .must-read-row {
          display: flex; align-items: center;
          justify-content: space-between; gap: 1rem;
        }

        .must-read-text-block { flex: 1; }

        .must-read-label {
          font-size: 0.9rem; font-weight: 600;
          color: #374151; display: block; margin-bottom: 0.2rem;
        }

        .must-read-desc { font-size: 0.78rem; color: #9ca3af; line-height: 1.5; }

        .toggle-switch {
          position: relative; width: 44px; height: 24px; flex-shrink: 0;
        }
        .toggle-switch input { opacity: 0; width: 0; height: 0; }

        .toggle-track {
          position: absolute; inset: 0; border-radius: 999px;
          background: #e5e7eb; cursor: pointer; transition: background 0.2s;
        }
        .toggle-switch input:checked + .toggle-track { background: #00b8b8; }
        .toggle-track::after {
          content: ''; position: absolute;
          left: 3px; top: 3px; width: 18px; height: 18px;
          border-radius: 50%; background: white;
          transition: transform 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.15);
        }
        .toggle-switch input:checked + .toggle-track::after { transform: translateX(20px); }

        /* Error */
        .cp-error {
          display: flex; align-items: center; gap: 0.5rem;
          background: #fef2f2; border: 1px solid #fecaca;
          border-radius: 10px; padding: 0.75rem 1rem;
          color: #dc2626; font-size: 0.85rem;
          font-weight: 500; margin-bottom: 1rem;
        }

        /* Submit */
        .cp-submit-row {
          display: flex; align-items: center;
          justify-content: flex-end; gap: 0.75rem;
          margin-top: 1.25rem;
        }

        .btn-cancel {
          padding: 0.65rem 1.3rem; background: white;
          border: 1px solid #e5e7eb; border-radius: 10px;
          font-size: 0.88rem; font-weight: 600;
          color: #6b7280; cursor: pointer; transition: all 0.12s;
        }
        .btn-cancel:hover { background: #f9fafb; border-color: #d1d5db; }

        .btn-publish {
          display: flex; align-items: center; gap: 0.5rem;
          padding: 0.65rem 1.6rem; background: #0d2d3a;
          color: white; border: none; border-radius: 10px;
          font-size: 0.88rem; font-weight: 700;
          cursor: pointer; transition: background 0.15s;
        }
        .btn-publish:hover:not(:disabled) { background: #00b8b8; }
        .btn-publish:disabled { opacity: 0.45; cursor: not-allowed; }

        /* Settings section divider */
        .settings-divider {
          border: none; border-top: 1px solid #f3f4f6; margin: 1.1rem 0;
        }

        @media (max-width: 640px) {
          .cp-body { padding: 1rem 1rem 3rem; }
          .audience-options { grid-template-columns: 1fr; }
          .type-options { grid-template-columns: 1fr; }
          .event-dates { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="cp-page">
        <Navbar fullName={profile?.full_name ?? null} role={profile?.role ?? 'employee'} />

        <div className="cp-body">

          <div className="cp-page-header">
            <button className="cp-back-btn" onClick={() => navigate('/dashboard')}>
              ← Back to dashboard
            </button>
            <h1 className="cp-page-title">Create a post</h1>
            <p className="cp-page-sub">
              Publish an announcement, send a direct message, or schedule an event.
            </p>
          </div>

          {error && (
            <div className="cp-error">
              <span>⚠</span> {error}
            </div>
          )}

          {/* ── Audience ── */}
          <div className="cp-card">
            <div className="cp-card-header">
              <div className="cp-card-icon">📣</div>
              <p className="cp-card-title">Who sees this?</p>
            </div>
            <div className="cp-card-body">
              <div className="audience-options">
                <button
                  className={`audience-option${audience === 'global' ? ' selected' : ''}`}
                  onClick={() => setAudience('global')}
                >
                  <span className="audience-option-icon">🌐</span>
                  <span className="audience-option-label">Everyone</span>
                  <span className="audience-option-desc">Visible to all staff</span>
                </button>

                <button
                  className={`audience-option${audience === 'department' ? ' selected' : ''}`}
                  onClick={() => setAudience('department')}
                >
                  <span className="audience-option-icon">🏢</span>
                  <span className="audience-option-label">Department</span>
                  <span className="audience-option-desc">One team only</span>
                </button>

                <button
                  className={`audience-option${audience === 'personal' ? ' selected' : ''}`}
                  onClick={() => setAudience('personal')}
                >
                  <span className="audience-option-icon">💬</span>
                  <span className="audience-option-label">One person</span>
                  <span className="audience-option-desc">Private message</span>
                </button>
              </div>

              {/* Department picker */}
              {audience === 'department' && (
                <div className="audience-sub">
                  <span className="sub-label">Select department</span>
                  <select
                    className="cp-select"
                    value={selectedDeptId}
                    onChange={e => setSelectedDeptId(e.target.value)}
                  >
                    <option value="">Choose a department…</option>
                    {departments.map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* User search */}
              {audience === 'personal' && (
                <div className="audience-sub">
                  <span className="sub-label">Search for a recipient</span>
                  <div className="user-search-wrap" ref={searchRef}>
                    <div className="user-search-input-row">
                      {selectedRecipient ? (
                        <div className="selected-chip">
                          <div className="chip-avatar">
                            {(selectedRecipient.full_name ?? '?').charAt(0).toUpperCase()}
                          </div>
                          <span className="chip-name">{selectedRecipient.full_name}</span>
                          <button
                            className="chip-remove"
                            onClick={() => { setSelectedRecipient(null); setUserSearchQuery('') }}
                          >✕</button>
                        </div>
                      ) : (
                        <>
                          <span style={{ color: '#9ca3af', fontSize: '0.85rem', flexShrink: 0 }}>🔍</span>
                          <input
                            placeholder="Type a name to search…"
                            value={userSearchQuery}
                            onChange={e => { setUserSearchQuery(e.target.value); setSearchOpen(true) }}
                            onFocus={() => setSearchOpen(true)}
                            autoComplete="off"
                          />
                        </>
                      )}
                    </div>

                    {searchOpen && !selectedRecipient && (
                      <div className="user-dropdown">
                        {filteredUsers.length === 0 ? (
                          <div className="user-dropdown-empty">No users found</div>
                        ) : filteredUsers.slice(0, 30).map(p => {
                          const dept = departments.find(d => d.id === p.department_id)
                          return (
                            <div
                              key={p.id}
                              className="user-dropdown-item"
                              onMouseDown={() => {
                                setSelectedRecipient(p)
                                setUserSearchQuery('')
                                setSearchOpen(false)
                              }}
                            >
                              <div className="user-dropdown-avatar">
                                {(p.full_name ?? '?').charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <span className="user-dropdown-name">{p.full_name ?? '—'}</span>
                                <span className="user-dropdown-dept">
                                  {dept?.name ?? 'No department'} · {p.role}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Content ── */}
          <div className="cp-card">
            <div className="cp-card-header">
              <div className="cp-card-icon">✏️</div>
              <p className="cp-card-title">Content</p>
            </div>
            <div className="cp-card-body">
              <input
                className="cp-title-input"
                placeholder="Post title…"
                value={title}
                onChange={e => setTitle(e.target.value)}
                maxLength={120}
              />
              <hr className="cp-divider" />
              <textarea
                className="cp-content-textarea"
                placeholder="Write your message here…"
                value={content}
                onChange={e => setContent(e.target.value)}
              />
              <p className="cp-word-count">
                {wordCount} {wordCount === 1 ? 'word' : 'words'}
              </p>
            </div>
          </div>

          {/* ── Settings ── */}
          <div className="cp-card">
            <div className="cp-card-header">
              <div className="cp-card-icon">⚙️</div>
              <p className="cp-card-title">Settings</p>
            </div>
            <div className="cp-card-body">

              {/* Post type */}
              <span className="sub-label">Post type</span>
              <div className="type-options">
                <button
                  className={`type-option${postType === 'announcement' ? ' selected' : ''}`}
                  onClick={() => setPostType('announcement')}
                >
                  <span className="type-option-icon">📢</span>
                  <span>
                    <span className="type-option-label">Announcement</span>
                    <span className="type-option-desc">Standard post or notice</span>
                  </span>
                </button>

                <button
                  className={`type-option${postType === 'news_event' ? ' selected' : ''}`}
                  onClick={() => setPostType('news_event')}
                >
                  <span className="type-option-icon">📅</span>
                  <span>
                    <span className="type-option-label">News & Event</span>
                    <span className="type-option-desc">Has a date and time</span>
                  </span>
                </button>
              </div>

              {postType === 'news_event' && (
                <div className="event-dates">
                  <div className="date-field">
                    <label>Start date & time</label>
                    <input
                      type="datetime-local"
                      value={eventStart}
                      onChange={e => setEventStart(e.target.value)}
                    />
                  </div>
                  <div className="date-field">
                    <label>End date & time</label>
                    <input
                      type="datetime-local"
                      value={eventEnd}
                      onChange={e => setEventEnd(e.target.value)}
                    />
                  </div>
                </div>
              )}

              <hr className="settings-divider" />

              {/* Must read toggle */}
              <div className="must-read-row">
                <div className="must-read-text-block">
                  <span className="must-read-label">Require acknowledgement</span>
                  <span className="must-read-desc">
                    Recipients must mark this post as read before it clears from their dashboard.
                  </span>
                </div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={mustRead}
                    onChange={e => setMustRead(e.target.checked)}
                  />
                  <span className="toggle-track" />
                </label>
              </div>

            </div>
          </div>

          {/* Submit */}
          <div className="cp-submit-row">
            <button className="btn-cancel" onClick={() => navigate('/dashboard')}>
              Cancel
            </button>
            <button className="btn-publish" onClick={handleSubmit} disabled={!canSubmit}>
              {submitting ? '⏳ Publishing…' : '✓ Publish post'}
            </button>
          </div>

        </div>
      </div>
    </>
  )
}

export default CreatePostPage