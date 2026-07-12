import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Navbar from '../components/Navbar'
import { generateSummary } from '../lib/summarize'
import { usePresence } from '../contexts/PresenceContext'

interface Profile { id: string; full_name: string | null; role: string; department_id: string | null }
interface Department { id: string; name: string }
interface Post {
  id: string; title: string; content: string | null; post_type: string
  must_read: boolean; created_at: string; author_id: string
  department_id: string | null; recipient_id: string | null
  event_start: string | null; event_end: string | null
  attachment_url: string | null; post_status?: string; scheduled_at?: string | null
  author: { full_name: string | null; role: string } | null
}
interface Reaction { id: string; post_id: string; user_id: string; emoji: string }
interface Ack { id: string; post_id: string; user_id: string }
interface Comment {
  id: string; post_id: string; author_id: string; content: string; created_at: string
  author: { full_name: string | null; role: string } | null
}
interface PollQuestion {
  id: string; post_id: string; question: string
  multiple_choice: boolean; ends_at: string | null; created_at: string
}
interface PollOption { id: string; poll_id: string; option_text: string; order_index: number }
interface PollVote { id: string; poll_id: string; option_id: string; user_id: string }
interface PostView { post_id: string; user_id: string }

type Channel = 'global' | 'department' | 'events'
type SideView = 'feed' | 'analytics'
type PostFilter = 'all' | 'mustread' | 'polls' | 'today'

const QUICK_EMOJIS = ['👍','❤️','😂','😮','🎉','🔥','✅','💯']
const ROLE_COLORS: Record<string, string> = { admin:'#dc2626', hr:'#7c3aed', manager:'#1d4ed8', employee:'#16a34a' }
const STATUS_COLORS: Record<string, string> = { online:'#22c55e', away:'#f59e0b', busy:'#ef4444', offline:'#9ca3af' }
const STATUS_LABELS: Record<string, string> = { online:'Online', away:'Away', busy:'Busy', offline:'Offline' }

function fmtTime(d: string) { return new Date(d).toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit',hour12:true}) }
function fmtDate(d: string) { return new Date(d).toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'long'}) }
function fmtEventDate(d: string|null) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:true})
}
function timeAgo(d: string) {
  const diff = Math.floor((Date.now()-new Date(d).getTime())/1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff/86400)}d ago`
  return new Date(d).toLocaleDateString('en-AU',{day:'numeric',month:'short'})
}
function initials(name: string|null) {
  if (!name) return '?'
  return name.split(' ').filter(Boolean).slice(0,2).map(n=>n[0]).join('').toUpperCase()
}
function pollTimeLeft(endsAt: string|null): string {
  if (!endsAt) return ''
  const diff = new Date(endsAt).getTime() - Date.now()
  if (diff <= 0) return 'Ended'
  const d = Math.floor(diff/86400000)
  const h = Math.floor((diff%86400000)/3600000)
  if (d > 0) return `${d}d ${h}h left`
  return `${h}h left`
}

function Avatar({ name, size=32, role, online }: { name:string|null; size?:number; role?:string; online?:boolean }) {
  const bg = role ? (ROLE_COLORS[role]??'#243F60') : '#4F81BD'
  const statusColor = online ? '#22c55e' : undefined
  return (
    <div style={{ position:'relative', flexShrink:0, width:size, height:size }}>
      <div style={{ width:size, height:size, borderRadius:'50%', background:`linear-gradient(135deg,${bg}99,#243F60)`, color:'white', fontSize:size*0.35, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center' }}>
        {initials(name)}
      </div>
      {statusColor && (
        <div style={{ position:'absolute', bottom:0, right:0, width:size*0.28, height:size*0.28, borderRadius:'50%', background:statusColor, border:'1.5px solid white', boxShadow:'0 0 0 1px rgba(0,0,0,0.1)' }} />
      )}
    </div>
  )
}

// ── Poll Card ──────────────────────────────────────────────────
function PollCard({ poll, options, votes, userId, onVote, onUnvote, compact=false }:{
  poll: PollQuestion; options: PollOption[]; votes: PollVote[]
  userId: string|null; onVote:(optId:string)=>void; onUnvote:(optId:string)=>void; compact?:boolean
}) {
  const totalVotes = votes.length
  const myVotes = new Set(votes.filter(v=>v.user_id===userId).map(v=>v.option_id))
  const hasVoted = myVotes.size > 0
  const ended = poll.ends_at ? new Date(poll.ends_at) < new Date() : false
  const timeLeft = pollTimeLeft(poll.ends_at)

  function getCount(optId: string) { return votes.filter(v=>v.option_id===optId).length }
  function getPct(optId: string) { return totalVotes > 0 ? Math.round((getCount(optId)/totalVotes)*100) : 0 }

  const sorted = [...options].sort((a,b)=>a.order_index-b.order_index)

  return (
    <div className="poll-card">
      <div className="poll-header">
        <span className="poll-icon">📊</span>
        <div>
          <div className="poll-question">{poll.question}</div>
          <div className="poll-meta">
            {poll.multiple_choice && <span className="poll-type-badge">Multiple choice</span>}
            {timeLeft && <span className={`poll-time${ended?' ended':''}`}>{timeLeft}</span>}
            {totalVotes > 0 && <span className="poll-vote-count">{totalVotes} vote{totalVotes!==1?'s':''}</span>}
          </div>
        </div>
      </div>
      <div className="poll-options">
        {sorted.map(opt => {
          const isMine = myVotes.has(opt.id)
          const pct = getPct(opt.id)
          const count = getCount(opt.id)
          const showResults = hasVoted || ended
          return (
            <button
              key={opt.id}
              className={`poll-option${isMine?' voted':''}${showResults?' show-results':''}${ended?' ended':''}`}
              onClick={() => {
                if (ended || !userId) return
                if (isMine) onUnvote(opt.id)
                else {
                  if (!poll.multiple_choice) {
                    myVotes.forEach(id => onUnvote(id))
                  }
                  onVote(opt.id)
                }
              }}
              disabled={ended && !isMine}
            >
              {showResults && (
                <div className="poll-bar" style={{ width:`${pct}%`, background: isMine ? '#4BACC6' : '#e5e7eb' }} />
              )}
              <div className="poll-option-inner">
                <span className="poll-option-check">{isMine ? '✓' : ''}</span>
                <span className="poll-option-text">{opt.option_text}</span>
                {showResults && <span className="poll-option-pct">{pct}%{count>0?` · ${count}`:''}</span>}
              </div>
            </button>
          )
        })}
      </div>
      {!hasVoted && !ended && (
        <div className="poll-footer-hint">{poll.multiple_choice ? 'Select all that apply · ' : 'Choose one · '}{totalVotes} vote{totalVotes!==1?'s':''} so far</div>
      )}
      {hasVoted && !ended && (
        <div className="poll-footer-hint voted">✓ You voted · {totalVotes} vote{totalVotes!==1?'s':''} total</div>
      )}
    </div>
  )
}

// ── Analytics View ─────────────────────────────────────────────
function AnalyticsView({ posts, reactions, acks, polls, postViews, profiles, departments }:{
  posts: Post[]; reactions: Record<string,Reaction[]>; acks: Ack[]
  polls: Record<string,{question:PollQuestion;options:PollOption[];votes:PollVote[]}>
  postViews: Record<string,number>; profiles: Profile[]; departments: Department[]
}) {
  const totalPosts = posts.length
  const totalViews = Object.values(postViews).reduce((s,n)=>s+n,0)
  const totalReactions = Object.values(reactions).reduce((s,r)=>s+r.length,0)
  const mustReadPosts = posts.filter(p=>p.must_read)
  const totalAcks = acks.length
  const mustReadRate = mustReadPosts.length > 0
    ? Math.round((new Set(acks.map(a=>a.post_id)).size / mustReadPosts.length)*100)
    : 0

  // Top posts by engagement score
  const scoredPosts = posts.map(p => ({
    post: p,
    score: (reactions[p.id]?.length??0)*3 + (postViews[p.id]??0) + (acks.filter(a=>a.post_id===p.id).length)*2
  })).sort((a,b)=>b.score-a.score).slice(0,5)

  // Reaction breakdown
  const emojiCounts: Record<string,number> = {}
  Object.values(reactions).flat().forEach(r => { emojiCounts[r.emoji]=(emojiCounts[r.emoji]??0)+1 })
  const topEmojis = Object.entries(emojiCounts).sort((a,b)=>b[1]-a[1]).slice(0,6)

  // Department engagement
  const deptStats = departments.map(dept => {
    const members = profiles.filter(p=>p.department_id===dept.id)
    const deptPosts = posts.filter(p=>p.department_id===dept.id||!p.department_id)
    const deptReactions = new Set(Object.values(reactions).flat().filter(r=>members.some(m=>m.id===r.user_id)).map(r=>r.user_id))
    const engagement = members.length > 0 ? Math.round((deptReactions.size/members.length)*100) : 0
    return { dept, members: members.length, engagement, posts: deptPosts.length }
  }).sort((a,b)=>b.engagement-a.engagement)

  // Posts over time (last 7 days)
  const days = Array.from({length:7},(_,i)=>{
    const d = new Date(); d.setDate(d.getDate()-6+i)
    return d.toISOString().split('T')[0]
  })
  const postsByDay = days.map(day => ({
    label: new Date(day+'T12:00:00').toLocaleDateString('en-AU',{weekday:'short',day:'numeric'}),
    count: posts.filter(p=>p.created_at.startsWith(day)).length
  }))
  const maxDayCount = Math.max(...postsByDay.map(d=>d.count),1)

  // Poll stats
  const pollCount = Object.keys(polls).length
  const totalPollVotes = Object.values(polls).reduce((s,p)=>s+p.votes.length,0)

  return (
    <div className="analytics-view">
      <div className="analytics-header">
        <h2 className="analytics-title">📊 Analytics Dashboard</h2>
        <p className="analytics-sub">InfoWall engagement overview · Last 30 days</p>
      </div>

      {/* Stat cards */}
      <div className="analytics-stats-grid">
        {[
          { icon:'📢', val:totalPosts, label:'Total Posts', sub:`${posts.filter(p=>p.post_type==='news_event').length} events`, color:'#4BACC6' },
          { icon:'👁', val:totalViews.toLocaleString(), label:'Post Views', sub:`${totalViews>0?Math.round(totalViews/Math.max(totalPosts,1)):0} avg per post`, color:'#8064A2' },
          { icon:'💬', val:totalReactions, label:'Reactions', sub:`${topEmojis[0]?topEmojis[0][0]+' most popular':''}`, color:'#C0504D' },
          { icon:'✓', val:`${mustReadRate}%`, label:'Must-Read Rate', sub:`${totalAcks} acknowledgements`, color:'#9BBB59' },
          { icon:'📊', val:pollCount, label:'Active Polls', sub:`${totalPollVotes} total votes`, color:'#F79646' },
          { icon:'👥', val:profiles.length, label:'Staff Members', sub:`${departments.length} departments`, color:'#365F91' },
        ].map((s,i) => (
          <div key={i} className="analytics-stat-card">
            <div className="analytics-stat-icon" style={{ color:s.color }}>{s.icon}</div>
            <div className="analytics-stat-val" style={{ color:s.color }}>{s.val}</div>
            <div className="analytics-stat-label">{s.label}</div>
            <div className="analytics-stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="analytics-row">
        {/* Posts over time */}
        <div className="analytics-card">
          <div className="analytics-card-title">Posts this week</div>
          <div className="analytics-bar-chart">
            {postsByDay.map((day,i) => (
              <div key={i} className="analytics-bar-col">
                <div className="analytics-bar-track">
                  <div
                    className="analytics-bar-fill"
                    style={{ height:`${(day.count/maxDayCount)*100}%`, background:`linear-gradient(180deg,#4BACC6,#365F91)` }}
                    title={`${day.count} posts`}
                  />
                </div>
                <div className="analytics-bar-label">{day.label.split(' ')[0]}</div>
                <div className="analytics-bar-count">{day.count>0?day.count:''}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Reaction breakdown */}
        <div className="analytics-card">
          <div className="analytics-card-title">Top reactions</div>
          {topEmojis.length === 0 ? (
            <div className="analytics-empty">No reactions yet</div>
          ) : topEmojis.map(([emoji,count]) => (
            <div key={emoji} className="analytics-emoji-row">
              <span className="analytics-emoji">{emoji}</span>
              <div className="analytics-emoji-bar-track">
                <div className="analytics-emoji-bar" style={{ width:`${Math.round((count/(topEmojis[0][1]))*100)}%` }} />
              </div>
              <span className="analytics-emoji-count">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Top posts */}
      <div className="analytics-card" style={{ marginTop:'1rem' }}>
        <div className="analytics-card-title">🏆 Most engaged posts</div>
        {scoredPosts.length === 0 ? (
          <div className="analytics-empty">No posts yet</div>
        ) : scoredPosts.map(({post,score},i) => {
          const rxn = reactions[post.id]?.length??0
          const views = postViews[post.id]??0
          const postAcks = acks.filter(a=>a.post_id===post.id).length
          const maxScore = scoredPosts[0]?.score||1
          return (
            <div key={post.id} className="analytics-post-row">
              <div className="analytics-post-rank">{['🥇','🥈','🥉','4','5'][i]}</div>
              <div className="analytics-post-info">
                <div className="analytics-post-title">{post.title}</div>
                <div className="analytics-post-meta">
                  {rxn>0&&<span>💬 {rxn}</span>}
                  {views>0&&<span>👁 {views}</span>}
                  {postAcks>0&&<span>✓ {postAcks}</span>}
                  <span style={{color:'#c4c9d4'}}>{timeAgo(post.created_at)}</span>
                </div>
              </div>
              <div className="analytics-post-score-wrap">
                <div className="analytics-post-score-bar" style={{ width:`${Math.round((score/maxScore)*100)}%` }} />
                <span className="analytics-post-score">{score}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Department engagement */}
      <div className="analytics-card" style={{ marginTop:'1rem' }}>
        <div className="analytics-card-title">🏢 Department engagement</div>
        {deptStats.map(({dept,members,engagement}) => (
          <div key={dept.id} className="analytics-dept-row">
            <div className="analytics-dept-name">{dept.name}</div>
            <div className="analytics-dept-bar-track">
              <div className="analytics-dept-bar" style={{ width:`${engagement}%`, background: engagement>70?'#9BBB59':engagement>40?'#F79646':'#C0504D' }} />
            </div>
            <div className="analytics-dept-pct" style={{ color:engagement>70?'#9BBB59':engagement>40?'#F79646':'#C0504D' }}>{engagement}%</div>
            <div className="analytics-dept-members">{members} staff</div>
          </div>
        ))}
      </div>

      {/* Must-read detail */}
      {mustReadPosts.length > 0 && (
        <div className="analytics-card" style={{ marginTop:'1rem' }}>
          <div className="analytics-card-title">⚠ Must-read completion</div>
          {mustReadPosts.map(post => {
            const postAcks = new Set(acks.filter(a=>a.post_id===post.id).map(a=>a.user_id))
            const rate = profiles.length > 0 ? Math.round((postAcks.size/profiles.length)*100) : 0
            return (
              <div key={post.id} className="analytics-mustread-row">
                <div className="analytics-mustread-title">{post.title}</div>
                <div className="analytics-mustread-bar-wrap">
                  <div className="analytics-mustread-bar-track">
                    <div className="analytics-mustread-bar" style={{ width:`${rate}%`, background:rate>=80?'#9BBB59':rate>=50?'#F79646':'#C0504D' }} />
                  </div>
                  <span className="analytics-mustread-pct">{rate}%</span>
                </div>
                <div className="analytics-mustread-count">{postAcks.size}/{profiles.length} read</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════
// MAIN DASHBOARD COMPONENT
// ═══════════════════════════════════════════════════
export default function DashboardPage() {
  const navigate = useNavigate()
  const { onlineUserIds, presenceUsers, myStatus, setMyStatus } = usePresence()

  const [profile, setProfile] = useState<Profile|null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [posts, setPosts] = useState<Post[]>([])
  const [allProfiles, setAllProfiles] = useState<Profile[]>([])
  const [reactions, setReactions] = useState<Record<string,Reaction[]>>({})
  const [acks, setAcks] = useState<Ack[]>([])
  const [allAcks, setAllAcks] = useState<Ack[]>([])
  const [commentCounts, setCommentCounts] = useState<Record<string,number>>({})
  const [postViews, setPostViews] = useState<Record<string,number>>({})
  const [loading, setLoading] = useState(true)

  // Polls
  const [polls, setPolls] = useState<Record<string,{question:PollQuestion;options:PollOption[];votes:PollVote[]}>>({})

  // UI state
  const [channel, setChannel] = useState<Channel>('global')
  const [sideView, setSideView] = useState<SideView>('feed')
  const [postFilter, setPostFilter] = useState<PostFilter>('all')
  const [search, setSearch] = useState('')
  const [showEmojiFor, setShowEmojiFor] = useState<string|null>(null)
  const [showReactorsFor, setShowReactorsFor] = useState<string|null>(null)
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [showOnlineList, setShowOnlineList] = useState(true)

  // Thread state
  const [threadPost, setThreadPost] = useState<Post|null>(null)
  const [threadComments, setThreadComments] = useState<Comment[]>([])
  const [threadInput, setThreadInput] = useState('')
  const [loadingThread, setLoadingThread] = useState(false)
  const [sendingComment, setSendingComment] = useState(false)
  const [deletingCommentId, setDeletingCommentId] = useState<string|null>(null)

  const threadEndRef = useRef<HTMLDivElement>(null)
  const threadInputRef = useRef<HTMLTextAreaElement>(null)
  const realtimeRef = useRef<ReturnType<typeof supabase.channel>|null>(null)
  const viewedPostsRef = useRef<Set<string>>(new Set())

  const statusMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showEmojiFor&&!showReactorsFor&&!showStatusMenu) return
    function h(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('.emoji-picker-db') && !(e.target as HTMLElement).closest('.emoji-trigger-db')) setShowEmojiFor(null)
      if (!(e.target as HTMLElement).closest('.reactors-tooltip') && !(e.target as HTMLElement).closest('.db-reaction-pill')) setShowReactorsFor(null)
      if (!statusMenuRef.current?.contains(e.target as Node)) setShowStatusMenu(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [showEmojiFor, showReactorsFor, showStatusMenu])

  useEffect(() => { threadEndRef.current?.scrollIntoView({behavior:'smooth'}) }, [threadComments])

  useEffect(() => {
    async function load() {
      const { data:{user} } = await supabase.auth.getUser()
      if (!user) { navigate('/login'); return }

      const [{ data:p }, { data:ds }, { data:allP }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('departments').select('*').order('name'),
        supabase.from('profiles').select('*').order('full_name'),
      ])
      setProfile(p)
      setDepartments(ds??[])
      setAllProfiles(allP??[])
      await loadPosts(user.id, p?.department_id??null)
      setLoading(false)
    }
    load()

    realtimeRef.current = supabase.channel('dashboard-realtime')
      .on('postgres_changes', {event:'INSERT', schema:'public', table:'posts'}, async (payload) => {
        const newPost = payload.new as Post
        const {data:author} = await supabase.from('profiles').select('full_name,role').eq('id',newPost.author_id).single()
        setPosts(prev => [{...newPost,author:author??null},...prev])
      })
      .on('postgres_changes', {event:'DELETE', schema:'public', table:'posts'}, (payload) => {
        setPosts(prev => prev.filter(p=>p.id!==(payload.old as {id:string}).id))
      })
      .on('postgres_changes', {event:'INSERT', schema:'public', table:'post_reactions'}, (payload) => {
        const r = payload.new as Reaction
        setReactions(prev=>({...prev,[r.post_id]:[...(prev[r.post_id]??[]).filter(x=>x.id!==r.id),r]}))
      })
      .on('postgres_changes', {event:'DELETE', schema:'public', table:'post_reactions'}, (payload) => {
        const r = payload.old as {id:string;post_id:string}
        setReactions(prev=>({...prev,[r.post_id]:(prev[r.post_id]??[]).filter(x=>x.id!==r.id)}))
      })
      .on('postgres_changes', {event:'INSERT', schema:'public', table:'post_comments'}, async (payload) => {
        const c = payload.new as Comment
        setCommentCounts(prev=>({...prev,[c.post_id]:(prev[c.post_id]??0)+1}))
        if (threadPost?.id===c.post_id) {
          const {data:author} = await supabase.from('profiles').select('full_name,role').eq('id',c.author_id).single()
          setThreadComments(prev => prev.find(x=>x.id===c.id)?prev:[...prev,{...c,author:author??null}])
        }
      })
      .on('postgres_changes', {event:'DELETE', schema:'public', table:'post_comments'}, (payload) => {
        const c = payload.old as {id:string;post_id:string}
        setCommentCounts(prev=>({...prev,[c.post_id]:Math.max(0,(prev[c.post_id]??1)-1)}))
        setThreadComments(prev=>prev.filter(x=>x.id!==c.id))
      })
      .on('postgres_changes', {event:'INSERT', schema:'public', table:'poll_votes'}, (payload) => {
        const v = payload.new as PollVote
        setPolls(prev => {
          const poll = Object.values(prev).find(p=>p.question.id===v.poll_id)
          if (!poll) return prev
          return {...prev,[poll.question.post_id]:{...poll, votes:[...poll.votes.filter(x=>!(x.poll_id===v.poll_id&&x.user_id===v.user_id&&x.option_id===v.option_id)),v]}}
        })
      })
      .on('postgres_changes', {event:'DELETE', schema:'public', table:'poll_votes'}, (payload) => {
        const v = payload.old as {id:string;poll_id:string;option_id:string;user_id:string}
        setPolls(prev => {
          const poll = Object.values(prev).find(p=>p.question.id===v.poll_id)
          if (!poll) return prev
          return {...prev,[poll.question.post_id]:{...poll, votes:poll.votes.filter(x=>x.id!==v.id)}}
        })
      })
      .subscribe()

    return () => { if (realtimeRef.current) supabase.removeChannel(realtimeRef.current) }
  }, [navigate])

  const loadPosts = useCallback(async (uid: string, deptId: string|null) => {
    const {data:ps} = await supabase.from('posts')
      .select('*, author:profiles!author_id(full_name,role)')
      .order('created_at',{ascending:false})
    if (!ps) return

    setPosts(ps as Post[])
    const ids = ps.map(p=>p.id)
    if (!ids.length) return

    const [
      {data:rs}, {data:myAcks}, {data:allAcksData},
      {data:cs}, {data:pvs},
      {data:pollQs}
    ] = await Promise.all([
      supabase.from('post_reactions').select('*').in('post_id',ids),
      supabase.from('acknowledgements').select('*').eq('user_id',uid).in('post_id',ids),
      supabase.from('acknowledgements').select('*').in('post_id',ids),
      supabase.from('post_comments').select('post_id').in('post_id',ids),
      supabase.from('post_views').select('post_id').in('post_id',ids),
      supabase.from('poll_questions').select('*').in('post_id',ids),
    ])

    const grouped: Record<string,Reaction[]> = {}
    ;(rs??[]).forEach(r=>{if(!grouped[r.post_id])grouped[r.post_id]=[];grouped[r.post_id].push(r)})
    setReactions(grouped)
    setAcks(myAcks??[])
    setAllAcks(allAcksData??[])

    const counts: Record<string,number> = {}
    ;(cs??[]).forEach((c:{post_id:string})=>{counts[c.post_id]=(counts[c.post_id]??0)+1})
    setCommentCounts(counts)

    const viewCounts: Record<string,number> = {}
    ;(pvs??[]).forEach((v:{post_id:string})=>{viewCounts[v.post_id]=(viewCounts[v.post_id]??0)+1})
    setPostViews(viewCounts)

    // Load polls
    if (pollQs && pollQs.length > 0) {
      const pollIds = pollQs.map(q=>q.id)
      const [{data:opts},{data:votes}] = await Promise.all([
        supabase.from('poll_options').select('*').in('poll_id',pollIds),
        supabase.from('poll_votes').select('*').in('poll_id',pollIds),
      ])
      const pollMap: typeof polls = {}
      pollQs.forEach(q => {
        pollMap[q.post_id] = {
          question: q as PollQuestion,
          options: (opts??[]).filter((o:PollOption)=>o.poll_id===q.id),
          votes: (votes??[]).filter((v:PollVote)=>v.poll_id===q.id),
        }
      })
      setPolls(pollMap)
    }
  }, [])

  // Record post view
  async function recordView(postId: string) {
    if (!profile || viewedPostsRef.current.has(postId)) return
    viewedPostsRef.current.add(postId)
    await supabase.from('post_views').insert({post_id:postId,user_id:profile.id}).then(()=>{})
    setPostViews(prev=>({...prev,[postId]:(prev[postId]??0)+1}))
  }

  async function openThread(post: Post) {
    setThreadPost(post)
    setLoadingThread(true)
    setThreadInput('')
    recordView(post.id)
    const {data} = await supabase.from('post_comments')
      .select('*, author:profiles!author_id(full_name,role)')
      .eq('post_id',post.id).order('created_at',{ascending:true})
    setThreadComments((data??[]) as Comment[])
    setLoadingThread(false)
    setTimeout(()=>threadInputRef.current?.focus(),100)
  }

  async function sendComment() {
    if (!threadInput.trim()||!threadPost||!profile||sendingComment) return
    setSendingComment(true)
    const {data} = await supabase.from('post_comments').insert({
      post_id:threadPost.id,author_id:profile.id,content:threadInput.trim()
    }).select('*, author:profiles!author_id(full_name,role)').single()
    if (data) {
      setThreadComments(prev=>prev.find(c=>c.id===data.id)?prev:[...prev,data as Comment])
      setCommentCounts(prev=>({...prev,[threadPost.id]:(prev[threadPost.id]??0)+1}))
    }
    setThreadInput('')
    setSendingComment(false)
    threadInputRef.current?.focus()
  }

  async function deleteComment(commentId: string, postId: string) {
    if (!window.confirm('Delete this reply?')) return
    setDeletingCommentId(commentId)
    await supabase.from('post_comments').delete().eq('id',commentId)
    setThreadComments(prev=>prev.filter(c=>c.id!==commentId))
    setCommentCounts(prev=>({...prev,[postId]:Math.max(0,(prev[postId]??1)-1)}))
    setDeletingCommentId(null)
  }

  async function toggleReaction(postId: string, emoji: string) {
    if (!profile) return
    const existing = (reactions[postId]??[]).find(r=>r.user_id===profile.id&&r.emoji===emoji)
    if (existing) {
      await supabase.from('post_reactions').delete().eq('id',existing.id)
      setReactions(prev=>({...prev,[postId]:(prev[postId]??[]).filter(r=>r.id!==existing.id)}))
    } else {
      const {data} = await supabase.from('post_reactions').insert({post_id:postId,user_id:profile.id,emoji}).select().single()
      if (data) setReactions(prev=>({...prev,[postId]:[...(prev[postId]??[]),data]}))
    }
    setShowEmojiFor(null)
  }

  async function toggleAck(postId: string) {
    if (!profile) return
    const existing = acks.find(a=>a.post_id===postId)
    if (existing) {
      await supabase.from('acknowledgements').delete().eq('id',existing.id)
      setAcks(prev=>prev.filter(a=>a.id!==existing.id))
    } else {
      const {data} = await supabase.from('acknowledgements').insert({post_id:postId,user_id:profile.id}).select().single()
      if (data) setAcks(prev=>[...prev,data])
    }
  }

  async function deletePost(postId: string) {
    if (!window.confirm('Delete this post?')) return
    await supabase.from('posts').delete().eq('id',postId)
    setPosts(prev=>prev.filter(p=>p.id!==postId))
    if (threadPost?.id===postId) setThreadPost(null)
  }

  async function votePoll(pollId: string, postId: string, optionId: string) {
    if (!profile) return
    await supabase.from('poll_votes').insert({poll_id:pollId,option_id:optionId,user_id:profile.id})
  }

  async function unvotePoll(pollId: string, postId: string, optionId: string) {
    if (!profile) return
    await supabase.from('poll_votes').delete()
      .eq('poll_id',pollId).eq('option_id',optionId).eq('user_id',profile.id)
  }

  function groupReactions(postId: string) {
    const raw = reactions[postId]??[]
    const map: Record<string,{count:number;iMine:boolean;reactors:string[]}> = {}
    raw.forEach(r=>{
      if(!map[r.emoji]) map[r.emoji]={count:0,iMine:false,reactors:[]}
      map[r.emoji].count++
      if(r.user_id===profile?.id) map[r.emoji].iMine=true
      const p = allProfiles.find(x=>x.id===r.user_id)
      if(p) map[r.emoji].reactors.push(p.full_name?.split(' ')[0]??'Someone')
    })
    return Object.entries(map).map(([emoji,v])=>({emoji,...v}))
  }

  // Filter posts
  const today = new Date().toISOString().split('T')[0]
  const filteredPosts = posts.filter(p => {
    if (p.post_status && p.post_status !== 'published') return false
    const matchChannel =
      channel==='global' ? !p.department_id&&!p.recipient_id&&p.post_type==='announcement'
      : channel==='department' ? !!p.department_id&&p.post_type==='announcement'
      : p.post_type==='news_event'
    if (!matchChannel) return false
    if (search && !p.title.toLowerCase().includes(search.toLowerCase()) && !(p.content??'').toLowerCase().includes(search.toLowerCase())) return false
    if (postFilter==='mustread' && !p.must_read) return false
    if (postFilter==='polls' && !polls[p.id]) return false
    if (postFilter==='today' && !p.created_at.startsWith(today)) return false
    return true
  })

  // Group by date
  const grouped: {label:string;posts:Post[]}[] = []
  filteredPosts.forEach(p => {
    const label = fmtDate(p.created_at)
    const g = grouped.find(x=>x.label===label)
    if(g) g.posts.push(p); else grouped.push({label,posts:[p]})
  })

  const mustReadPending = posts.filter(p=>p.must_read&&!acks.find(a=>a.post_id===p.id))
  const myDept = departments.find(d=>d.id===profile?.department_id)
  const canPost = ['hr','manager','admin'].includes(profile?.role??'')

  const onlineUsers = presenceUsers.filter(u=>u.user_id!==profile?.id)
  const onlineCount = onlineUsers.filter(u=>u.status==='online').length

  if (loading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',fontFamily:'Nunito,sans-serif',color:'#6b7280'}}>Loading…</div>

  const channelConfig = {
    global: {label:'Global',icon:'🌐',desc:'Company-wide announcements'},
    department: {label:myDept?.name??'Department',icon:'🏢',desc:'Your department posts'},
    events: {label:'Events',icon:'📅',desc:'Upcoming events & news'},
  }

  return (
    <>
      <style>{`
        @keyframes fadeIn    { from{opacity:0} to{opacity:1} }
        @keyframes slideIn   { from{opacity:0;transform:translateX(32px)} to{opacity:1;transform:translateX(0)} }
        @keyframes postIn    { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes reactionPop { from{opacity:0;transform:scale(0.5)} to{opacity:1;transform:scale(1)} }
        @keyframes commentIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes emojiIn   { from{opacity:0;transform:scale(0.85) translateY(6px)} to{opacity:1;transform:scale(1) translateY(0)} }
        @keyframes pulse2    { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes barFill   { from{width:0} to{width:var(--w)} }
        @keyframes pollFill  { from{width:0} }

        *,*::before,*::after { box-sizing:border-box; }

        .db { display:flex;flex-direction:column;height:100vh;font-family:'Nunito','Segoe UI',system-ui,sans-serif;background:var(--bg-page);overflow:hidden; }
        .db-shell { display:flex;flex:1;min-height:0;overflow:hidden; }

        /* ── Sidebar ── */
        .db-sidebar { width:240px;flex-shrink:0;background:#1A2B3C;display:flex;flex-direction:column;overflow:hidden; }
        .db-sidebar-brand { padding:1.1rem 1.1rem 0.85rem;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0; }
        .db-sidebar-workspace { font-size:0.95rem;font-weight:800;color:white;letter-spacing:-0.01em; }
        .db-sidebar-sub { font-size:0.7rem;color:rgba(255,255,255,0.35);margin-top:0.15rem; }

        /* Status bar */
        .db-status-bar { display:flex;align-items:center;gap:0.5rem;padding:0.6rem 1.1rem;border-bottom:1px solid rgba(255,255,255,0.07);cursor:pointer;position:relative;flex-shrink:0; }
        .db-status-bar:hover { background:rgba(255,255,255,0.04); }
        .db-status-dot { width:9px;height:9px;border-radius:50%;flex-shrink:0; }
        .db-status-label { font-size:0.75rem;color:rgba(255,255,255,0.55);flex:1; }
        .db-status-menu {
          position:absolute;top:calc(100%+4px);left:0.75rem;
          background:#0d1f30;border:1px solid rgba(255,255,255,0.1);border-radius:10px;
          padding:0.35rem;z-index:100;min-width:160px;
          box-shadow:0 8px 24px rgba(0,0,0,0.4);
        }
        .db-status-option { display:flex;align-items:center;gap:0.55rem;padding:0.45rem 0.65rem;border-radius:7px;cursor:pointer;transition:background 0.1s; }
        .db-status-option:hover { background:rgba(255,255,255,0.07); }
        .db-status-option-label { font-size:0.8rem;color:rgba(255,255,255,0.7);font-weight:600; }

        .db-sidebar-scroll { flex:1;overflow-y:auto; }
        .db-sidebar-scroll::-webkit-scrollbar{width:2px}
        .db-sidebar-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:999px}

        .db-channel-section { padding:0.85rem 0.6rem 0.4rem; }
        .db-channel-label { font-size:0.6rem;font-weight:800;color:rgba(255,255,255,0.28);text-transform:uppercase;letter-spacing:0.12em;padding:0 0.5rem;margin-bottom:0.4rem;display:block; }
        .db-channel-btn { display:flex;align-items:center;gap:0.6rem;width:100%;padding:0.5rem 0.75rem;border:none;background:transparent;border-radius:7px;font-size:0.85rem;font-weight:500;color:rgba(255,255,255,0.5);cursor:pointer;transition:all 0.12s;text-align:left;font-family:inherit;margin-bottom:0.15rem; }
        .db-channel-btn:hover { background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.85); }
        .db-channel-btn.active { background:rgba(75,172,198,0.15);color:white;font-weight:700; }
        .db-channel-btn.analytics-btn.active { background:rgba(128,100,162,0.18);color:#c4b5fd; }
        .db-channel-hash { font-size:0.85rem;opacity:0.6; }
        .db-channel-name { flex:1; }
        .db-channel-count { font-size:0.65rem;background:rgba(192,80,77,0.85);color:white;border-radius:999px;padding:0.1rem 0.4rem;font-weight:800; }
        .db-filter-chip { display:flex;align-items:center;gap:0.45rem;width:100%;padding:0.42rem 0.75rem;border:none;background:transparent;border-radius:7px;font-size:0.78rem;font-weight:500;color:rgba(255,255,255,0.4);cursor:pointer;transition:all 0.12s;text-align:left;font-family:inherit;margin-bottom:0.1rem; }
        .db-filter-chip:hover { background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.75); }
        .db-filter-chip.active { color:rgba(255,255,255,0.85);font-weight:600; }

        /* Online users */
        .db-online-section { padding:0.7rem 0.6rem 0;border-top:1px solid rgba(255,255,255,0.07);margin-top:auto; }
        .db-online-header { display:flex;align-items:center;justify-content:space-between;padding:0 0.5rem;margin-bottom:0.4rem; }
        .db-online-label { font-size:0.6rem;font-weight:800;color:rgba(255,255,255,0.28);text-transform:uppercase;letter-spacing:0.1em;display:flex;align-items:center;gap:0.4rem; }
        .db-online-count { background:rgba(34,197,94,0.2);color:#86efac;font-size:0.62rem;font-weight:800;padding:0.08rem 0.4rem;border-radius:999px; }
        .db-online-toggle { background:none;border:none;color:rgba(255,255,255,0.2);cursor:pointer;font-size:0.7rem;transition:color 0.12s; }
        .db-online-toggle:hover { color:rgba(255,255,255,0.55); }
        .db-online-user { display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0.5rem;border-radius:6px;cursor:pointer;transition:background 0.1s;margin-bottom:0.1rem; }
        .db-online-user:hover { background:rgba(255,255,255,0.05); }
        .db-online-user-name { font-size:0.75rem;color:rgba(255,255,255,0.6);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .db-online-user-status { font-size:0.62rem;color:rgba(255,255,255,0.3); }
        .db-sidebar-footer { padding:0.85rem 1rem;border-top:1px solid rgba(255,255,255,0.07);flex-shrink:0; }
        .db-sidebar-user { display:flex;align-items:center;gap:0.6rem;cursor:pointer;padding:0.4rem 0.35rem;border-radius:7px;transition:background 0.12s; }
        .db-sidebar-user:hover { background:rgba(255,255,255,0.06); }
        .db-sidebar-name { font-size:0.8rem;font-weight:700;color:rgba(255,255,255,0.8);display:block;line-height:1.2; }
        .db-sidebar-role { font-size:0.65rem;text-transform:capitalize;color:rgba(255,255,255,0.35);display:block; }

        /* ── Main ── */
        .db-main { flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden; }
        .db-topbar { display:flex;align-items:center;gap:1rem;padding:0.75rem 1.5rem;background:var(--bg-surface);border-bottom:1px solid var(--border);flex-shrink:0;box-shadow:var(--shadow-sm); }
        .db-topbar-channel { font-size:1rem;font-weight:800;color:var(--text-primary);display:flex;align-items:center;gap:0.5rem; }
        .db-search-wrap { display:flex;align-items:center;gap:0.4rem;background:var(--bg-page);border:1px solid var(--border);border-radius:8px;padding:0.4rem 0.75rem;flex:1;max-width:320px; }
        .db-search-wrap input { background:transparent;border:none;outline:none;font-size:0.85rem;color:var(--text-primary);font-family:inherit;flex:1; }
        .db-search-wrap input::placeholder { color:var(--text-faint); }
        .db-new-post-btn { display:flex;align-items:center;gap:0.4rem;padding:0.5rem 1.1rem;background:#243F60;color:white;border:none;border-radius:8px;font-size:0.82rem;font-weight:700;cursor:pointer;transition:background 0.15s;font-family:inherit;white-space:nowrap; }
        .db-new-post-btn:hover { background:#365F91; }

        /* Post filter bar */
        .db-filter-bar { display:flex;align-items:center;gap:0.4rem;padding:0.55rem 1.5rem;background:var(--bg-surface);border-bottom:1px solid var(--border);flex-shrink:0;overflow-x:auto; }
        .db-filter-bar::-webkit-scrollbar{display:none}
        .pf-chip { padding:0.28rem 0.75rem;border:1px solid var(--border);border-radius:999px;font-size:0.75rem;font-weight:600;color:var(--text-muted);background:var(--bg-surface);cursor:pointer;transition:all 0.12s;font-family:inherit;white-space:nowrap; }
        .pf-chip:hover { border-color:#4BACC6;color:var(--text-primary); }
        .pf-chip.active { background:#EEF4FB;border-color:#4BACC6;color:#243F60; }
        .pf-results { font-size:0.75rem;color:var(--text-faint);margin-left:auto;flex-shrink:0; }

        /* Stats bar */
        .db-stats-bar { display:flex;align-items:center;gap:1.5rem;padding:0.45rem 1.5rem;background:#EEF4FB;border-bottom:1px solid #C5D9F1;flex-shrink:0; }
        .db-stat { display:flex;align-items:center;gap:0.4rem;font-size:0.73rem;color:#365F91;font-weight:600; }
        .db-stat strong { color:#243F60; }
        .db-online-pill { display:flex;align-items:center;gap:0.3rem;margin-left:auto;font-size:0.73rem;color:#16a34a;font-weight:600; }
        .db-online-pulse { width:7px;height:7px;border-radius:50%;background:#22c55e;animation:pulse2 2s ease-in-out infinite; }

        /* Must-read banner */
        .db-mustread-banner { display:flex;align-items:center;gap:0.75rem;padding:0.65rem 1.5rem;background:linear-gradient(90deg,rgba(192,80,77,0.08),rgba(192,80,77,0.04));border-bottom:1px solid rgba(192,80,77,0.15);flex-shrink:0; }
        .db-mustread-text { font-size:0.8rem;font-weight:600;color:#C0504D;flex:1; }
        .db-mustread-btn { padding:0.32rem 0.85rem;background:#C0504D;color:white;border:none;border-radius:6px;font-size:0.75rem;font-weight:700;cursor:pointer;font-family:inherit; }

        /* Content */
        .db-content { display:flex;flex:1;min-height:0;overflow:hidden; }

        /* Post list */
        .db-posts { flex:1;overflow-y:auto;padding:1.25rem 1.5rem;display:flex;flex-direction:column; }
        .db-posts::-webkit-scrollbar{width:5px}
        .db-posts::-webkit-scrollbar-thumb{background:var(--border);border-radius:999px}

        .db-date-divider { display:flex;align-items:center;gap:0.75rem;margin:0.5rem 0 1rem; }
        .db-date-line { flex:1;height:1px;background:var(--border); }
        .db-date-label { font-size:0.7rem;font-weight:700;color:var(--text-faint);white-space:nowrap;letter-spacing:0.06em;text-transform:uppercase; }

        /* Post card */
        .db-post { background:var(--bg-surface);border:1px solid var(--border);border-radius:14px;padding:1.25rem 1.35rem;margin-bottom:0.85rem;transition:box-shadow 0.15s,border-color 0.15s;animation:postIn 0.25s ease both;position:relative; }
        .db-post:hover { box-shadow:var(--shadow-md);border-color:#C5D9F1; }
        .db-post.must-read-pending { border-left:3px solid #C0504D; }
        .db-post.must-read-done { border-left:3px solid #16a34a; }

        .db-post-header { display:flex;align-items:flex-start;gap:0.75rem;margin-bottom:0.85rem; }
        .db-post-meta { flex:1;min-width:0; }
        .db-post-author { font-size:0.85rem;font-weight:700;color:var(--text-primary); }
        .db-post-time { font-size:0.72rem;color:var(--text-faint);margin-left:0.4rem; }
        .db-post-badges { display:flex;gap:0.35rem;flex-wrap:wrap;margin-top:0.3rem; }
        .db-badge { font-size:0.62rem;font-weight:700;padding:0.15rem 0.5rem;border-radius:4px;letter-spacing:0.05em;text-transform:uppercase; }
        .db-badge-ann { background:#EEF4FB;color:#365F91;border:1px solid #C5D9F1; }
        .db-badge-event { background:#F3EEF9;color:#8064A2;border:1px solid #D9CCF0; }
        .db-badge-must { background:#FEF2F2;color:#C0504D;border:1px solid #F4BDBB; }
        .db-badge-dept { background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0; }
        .db-badge-poll { background:#FFF7ED;color:#c2410c;border:1px solid #fed7aa; }

        .db-post-title { font-size:1rem;font-weight:800;color:var(--text-primary);margin-bottom:0.4rem;line-height:1.3;letter-spacing:-0.01em; }
        .db-ai-summary { display:flex;align-items:flex-start;gap:0.4rem;background:#EEF4FB;border:1px solid #C5D9F1;border-radius:8px;padding:0.55rem 0.85rem;margin-bottom:0.65rem; }
        .db-ai-icon { color:#4BACC6;font-size:0.78rem;flex-shrink:0;margin-top:0.1rem; }
        .db-ai-label { font-size:0.62rem;font-weight:800;color:#4BACC6;text-transform:uppercase;letter-spacing:0.08em;margin-right:0.3rem; }
        .db-ai-text { font-size:0.8rem;color:#365F91;line-height:1.55; }
        .db-post-content { font-size:0.9rem;color:var(--text-secondary);line-height:1.72;margin-bottom:0.75rem;font-family:'Source Serif 4','Georgia',serif;white-space:pre-wrap;word-break:break-word; }
        .db-event-card { display:flex;align-items:center;gap:0.65rem;background:#F3EEF9;border:1px solid #D9CCF0;border-radius:9px;padding:0.65rem 0.9rem;margin-bottom:0.75rem; }
        .db-event-date { font-size:0.82rem;font-weight:700;color:#8064A2; }
        .db-post-image { width:100%;max-height:260px;object-fit:cover;border-radius:9px;display:block;margin-bottom:0.75rem; }

        /* View count */
        .db-post-views { display:flex;align-items:center;gap:0.3rem;font-size:0.72rem;color:var(--text-faint);font-weight:500; }

        /* Post footer */
        .db-post-footer { display:flex;align-items:center;gap:0.65rem;flex-wrap:wrap;padding-top:0.65rem;border-top:1px solid var(--border-light); }
        .db-reactions-row { display:flex;align-items:center;gap:4px;flex-wrap:wrap;flex:1; }
        .db-reaction-pill { display:inline-flex;align-items:center;gap:3px;padding:3px 8px;border-radius:999px;border:1px solid var(--border);background:var(--bg-surface);font-size:0.82rem;cursor:pointer;transition:all 0.12s;animation:reactionPop 0.2s cubic-bezier(0.34,1.56,0.64,1);position:relative; }
        .db-reaction-pill:hover { border-color:#4BACC6;background:#EEF4FB; }
        .db-reaction-pill.mine { border-color:#4BACC6;background:#EEF4FB; }
        .db-reaction-count { font-size:0.72rem;font-weight:700;color:var(--text-secondary); }
        .db-reaction-pill.mine .db-reaction-count { color:#365F91; }

        /* Reactors tooltip */
        .reactors-tooltip { position:absolute;bottom:calc(100%+6px);left:50%;transform:translateX(-50%);background:#0f1d2a;color:white;font-size:0.7rem;font-weight:600;padding:0.35rem 0.6rem;border-radius:8px;white-space:nowrap;z-index:50;pointer-events:none;border:1px solid rgba(255,255,255,0.1);box-shadow:0 4px 12px rgba(0,0,0,0.4); }
        .reactors-tooltip::after { content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);border:5px solid transparent;border-top-color:#0f1d2a; }

        .emoji-trigger-db { width:28px;height:28px;border-radius:50%;background:var(--bg-hover);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:0.8rem;cursor:pointer;transition:all 0.12s;flex-shrink:0; }
        .emoji-trigger-db:hover { background:#EEF4FB;border-color:#4BACC6; }
        .emoji-picker-db { position:absolute;bottom:calc(100%+8px);left:0;background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:0.45rem;box-shadow:var(--shadow-lg);display:flex;gap:2px;z-index:100;animation:emojiIn 0.15s cubic-bezier(0.34,1.56,0.64,1); }
        .emoji-btn-db { width:34px;height:34px;border-radius:7px;border:none;background:transparent;font-size:1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.1s; }
        .emoji-btn-db:hover { background:var(--bg-hover); }

        .db-thread-btn { display:flex;align-items:center;gap:0.35rem;padding:0.32rem 0.75rem;background:transparent;border:1px solid var(--border);border-radius:999px;font-size:0.75rem;font-weight:600;color:var(--text-muted);cursor:pointer;transition:all 0.12s;font-family:inherit; }
        .db-thread-btn:hover { border-color:#4BACC6;color:var(--text-primary);background:#EEF4FB; }
        .db-thread-btn.has-replies { color:#365F91;border-color:#C5D9F1;background:#EEF4FB; }

        .db-ack-btn { display:flex;align-items:center;gap:0.35rem;padding:0.32rem 0.85rem;border-radius:999px;font-size:0.75rem;font-weight:700;cursor:pointer;transition:all 0.15s;font-family:inherit;margin-left:auto; }
        .db-ack-btn.pending { background:#FEF2F2;color:#C0504D;border:1px solid #F4BDBB; }
        .db-ack-btn.pending:hover { background:#C0504D;color:white; }
        .db-ack-btn.done { background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0; }

        .db-post-actions { position:absolute;top:1rem;right:1rem;display:flex;gap:4px;opacity:0;transition:opacity 0.15s; }
        .db-post:hover .db-post-actions { opacity:1; }
        .db-post-action-btn { padding:0.25rem 0.55rem;border:1px solid var(--border);border-radius:6px;background:var(--bg-surface);font-size:0.72rem;font-weight:600;color:var(--text-muted);cursor:pointer;transition:all 0.12s;font-family:inherit; }
        .db-post-action-btn.del:hover { background:#FEF2F2;color:#dc2626;border-color:#fecaca; }

        /* Empty */
        .db-empty { flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-faint);gap:0.75rem;text-align:center;padding:3rem; }

        /* ══════════════════════════════════════════
           POLLS
        ══════════════════════════════════════════ */
        .poll-card { background:var(--bg-page);border:1.5px solid #C5D9F1;border-radius:12px;padding:1rem 1.1rem;margin-bottom:0.75rem; }
        .poll-header { display:flex;align-items:flex-start;gap:0.6rem;margin-bottom:0.85rem; }
        .poll-icon { font-size:1.1rem;flex-shrink:0;margin-top:0.1rem; }
        .poll-question { font-size:0.9rem;font-weight:700;color:var(--text-primary);line-height:1.35; }
        .poll-meta { display:flex;align-items:center;gap:0.5rem;margin-top:0.3rem;flex-wrap:wrap; }
        .poll-type-badge { font-size:0.62rem;font-weight:700;background:#EEF4FB;color:#365F91;border:1px solid #C5D9F1;border-radius:4px;padding:0.1rem 0.4rem;letter-spacing:0.04em;text-transform:uppercase; }
        .poll-time { font-size:0.72rem;color:#9BBB59;font-weight:600; }
        .poll-time.ended { color:#C0504D; }
        .poll-vote-count { font-size:0.72rem;color:var(--text-faint);font-weight:500; }
        .poll-options { display:flex;flex-direction:column;gap:0.5rem; }
        .poll-option { position:relative;padding:0;border:1.5px solid var(--border);border-radius:9px;background:var(--bg-surface);cursor:pointer;text-align:left;font-family:inherit;transition:all 0.15s;overflow:hidden;min-height:40px; }
        .poll-option:hover:not(.ended) { border-color:#4BACC6; }
        .poll-option.voted { border-color:#4BACC6;background:rgba(75,172,198,0.05); }
        .poll-option.ended { cursor:default; }
        .poll-bar { position:absolute;top:0;left:0;bottom:0;border-radius:7px;transition:width 0.6s cubic-bezier(0.34,1,0.64,1);z-index:0; }
        .poll-option-inner { position:relative;z-index:1;display:flex;align-items:center;gap:0.55rem;padding:0.55rem 0.85rem; }
        .poll-option-check { width:16px;height:16px;border-radius:50%;border:1.5px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:0.6rem;color:white;flex-shrink:0;background:transparent;transition:all 0.15s; }
        .poll-option.voted .poll-option-check { background:#4BACC6;border-color:#4BACC6; }
        .poll-option-text { font-size:0.85rem;font-weight:600;color:var(--text-primary);flex:1; }
        .poll-option-pct { font-size:0.78rem;font-weight:700;color:var(--text-muted);flex-shrink:0; }
        .poll-option.voted .poll-option-pct { color:#365F91; }
        .poll-footer-hint { font-size:0.72rem;color:var(--text-faint);margin-top:0.6rem;text-align:center; }
        .poll-footer-hint.voted { color:#4BACC6;font-weight:600; }

        /* ══════════════════════════════════════════
           ANALYTICS VIEW
        ══════════════════════════════════════════ */
        .analytics-view { flex:1;overflow-y:auto;padding:1.5rem;max-width:1000px;width:100%; }
        .analytics-view::-webkit-scrollbar{width:5px}
        .analytics-view::-webkit-scrollbar-thumb{background:var(--border);border-radius:999px}
        .analytics-header { margin-bottom:1.5rem; }
        .analytics-title { font-size:1.35rem;font-weight:800;color:var(--text-primary);letter-spacing:-0.02em;margin-bottom:0.25rem; }
        .analytics-sub { font-size:0.82rem;color:var(--text-faint); }

        .analytics-stats-grid { display:grid;grid-template-columns:repeat(3,1fr);gap:0.85rem;margin-bottom:1.25rem; }
        .analytics-stat-card { background:var(--bg-surface);border:1px solid var(--border);border-radius:14px;padding:1.1rem 1.25rem;display:flex;flex-direction:column;gap:0.3rem;transition:box-shadow 0.15s; }
        .analytics-stat-card:hover { box-shadow:var(--shadow-md); }
        .analytics-stat-icon { font-size:1.25rem; }
        .analytics-stat-val { font-size:1.75rem;font-weight:800;line-height:1;letter-spacing:-0.02em; }
        .analytics-stat-label { font-size:0.72rem;font-weight:700;color:var(--text-faint);text-transform:uppercase;letter-spacing:0.06em; }
        .analytics-stat-sub { font-size:0.72rem;color:var(--text-muted); }

        .analytics-row { display:grid;grid-template-columns:1fr 1fr;gap:1rem; }
        .analytics-card { background:var(--bg-surface);border:1px solid var(--border);border-radius:14px;padding:1.1rem 1.25rem; }
        .analytics-card-title { font-size:0.78rem;font-weight:800;color:var(--text-faint);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:1rem; }
        .analytics-empty { color:var(--text-ghost);font-size:0.85rem;text-align:center;padding:1rem 0; }

        /* Bar chart */
        .analytics-bar-chart { display:flex;align-items:flex-end;gap:0.4rem;height:100px; }
        .analytics-bar-col { display:flex;flex-direction:column;align-items:center;gap:0.25rem;flex:1; }
        .analytics-bar-track { flex:1;width:100%;display:flex;align-items:flex-end;background:var(--bg-page);border-radius:4px;overflow:hidden; }
        .analytics-bar-fill { width:100%;min-height:2px;border-radius:4px 4px 0 0;transition:height 0.6s ease; }
        .analytics-bar-label { font-size:0.62rem;color:var(--text-faint);white-space:nowrap; }
        .analytics-bar-count { font-size:0.65rem;font-weight:700;color:var(--text-muted);min-height:14px; }

        /* Emoji rows */
        .analytics-emoji-row { display:flex;align-items:center;gap:0.6rem;padding:0.35rem 0;border-bottom:1px solid var(--border-light); }
        .analytics-emoji-row:last-child { border-bottom:none; }
        .analytics-emoji { font-size:1.1rem;flex-shrink:0; }
        .analytics-emoji-bar-track { flex:1;height:6px;background:var(--bg-page);border-radius:999px;overflow:hidden; }
        .analytics-emoji-bar { height:100%;background:linear-gradient(90deg,#4BACC6,#8064A2);border-radius:999px;transition:width 0.5s ease; }
        .analytics-emoji-count { font-size:0.75rem;font-weight:700;color:var(--text-muted);flex-shrink:0;min-width:28px;text-align:right; }

        /* Top posts */
        .analytics-post-row { display:flex;align-items:center;gap:0.75rem;padding:0.7rem 0;border-bottom:1px solid var(--border-light); }
        .analytics-post-row:last-child { border-bottom:none; }
        .analytics-post-rank { font-size:1rem;flex-shrink:0;width:24px; }
        .analytics-post-info { flex:1;min-width:0; }
        .analytics-post-title { font-size:0.85rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .analytics-post-meta { display:flex;align-items:center;gap:0.5rem;font-size:0.72rem;color:var(--text-faint);margin-top:0.15rem; }
        .analytics-post-score-wrap { display:flex;align-items:center;gap:0.5rem;flex-shrink:0;width:100px; }
        .analytics-post-score-bar { height:5px;border-radius:999px;background:linear-gradient(90deg,#4BACC6,#8064A2);flex:1;transition:width 0.5s ease; }
        .analytics-post-score { font-size:0.72rem;font-weight:700;color:var(--text-muted);min-width:24px;text-align:right; }

        /* Dept bars */
        .analytics-dept-row { display:flex;align-items:center;gap:0.75rem;padding:0.55rem 0;border-bottom:1px solid var(--border-light); }
        .analytics-dept-row:last-child { border-bottom:none; }
        .analytics-dept-name { font-size:0.82rem;font-weight:600;color:var(--text-primary);width:110px;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .analytics-dept-bar-track { flex:1;height:7px;background:var(--bg-page);border-radius:999px;overflow:hidden; }
        .analytics-dept-bar { height:100%;border-radius:999px;transition:width 0.6s ease; }
        .analytics-dept-pct { font-size:0.75rem;font-weight:800;flex-shrink:0;width:36px;text-align:right; }
        .analytics-dept-members { font-size:0.68rem;color:var(--text-faint);flex-shrink:0; }

        /* Must-read rows */
        .analytics-mustread-row { padding:0.65rem 0;border-bottom:1px solid var(--border-light); }
        .analytics-mustread-row:last-child { border-bottom:none; }
        .analytics-mustread-title { font-size:0.82rem;font-weight:600;color:var(--text-primary);margin-bottom:0.35rem; }
        .analytics-mustread-bar-wrap { display:flex;align-items:center;gap:0.6rem;margin-bottom:0.2rem; }
        .analytics-mustread-bar-track { flex:1;height:6px;background:var(--bg-page);border-radius:999px;overflow:hidden; }
        .analytics-mustread-bar { height:100%;border-radius:999px;transition:width 0.6s ease; }
        .analytics-mustread-pct { font-size:0.75rem;font-weight:800;color:var(--text-muted);flex-shrink:0;width:36px;text-align:right; }
        .analytics-mustread-count { font-size:0.68rem;color:var(--text-faint); }

        /* ══════════════════════════════════════════
           THREAD PANEL
        ══════════════════════════════════════════ */
        .db-thread-panel { width:380px;flex-shrink:0;background:var(--bg-surface);border-left:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;animation:slideIn 0.22s ease; }
        .thread-header { display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid var(--border);flex-shrink:0; }
        .thread-title { font-size:0.95rem;font-weight:800;color:var(--text-primary);display:flex;align-items:center;gap:0.5rem; }
        .thread-close { width:28px;height:28px;border-radius:7px;background:var(--bg-hover);border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text-muted);font-size:0.85rem;transition:all 0.12s; }
        .thread-close:hover { background:#EEF4FB;color:#243F60; }
        .thread-orig { padding:1rem 1.25rem;border-bottom:2px solid #EEF4FB;background:var(--bg-subtle);flex-shrink:0; }
        .thread-orig-title { font-size:0.9rem;font-weight:800;color:var(--text-primary);margin-bottom:0.35rem; }
        .thread-orig-content { font-size:0.82rem;color:var(--text-muted);line-height:1.6;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;font-family:'Source Serif 4','Georgia',serif; }
        .thread-orig-meta { font-size:0.72rem;color:var(--text-faint);margin-top:0.4rem; }
        .thread-comments { flex:1;overflow-y:auto;padding:0.85rem 1.25rem;display:flex;flex-direction:column;gap:0.85rem; }
        .thread-comments::-webkit-scrollbar{width:3px}
        .thread-comments::-webkit-scrollbar-thumb{background:var(--border);border-radius:999px}
        .thread-comment { display:flex;gap:0.6rem;animation:commentIn 0.2s ease both; }
        .thread-comment-body { flex:1;min-width:0; }
        .thread-comment-header { display:flex;align-items:baseline;gap:0.4rem;margin-bottom:0.2rem; }
        .thread-comment-name { font-size:0.82rem;font-weight:700;color:var(--text-primary); }
        .thread-comment-time { font-size:0.68rem;color:var(--text-faint); }
        .thread-comment-del { background:none;border:none;cursor:pointer;color:var(--text-ghost);font-size:0.72rem;padding:0;margin-left:auto;transition:color 0.12s; }
        .thread-comment-del:hover { color:#dc2626; }
        .thread-comment-text { font-size:0.85rem;color:var(--text-secondary);line-height:1.6;white-space:pre-wrap;word-break:break-word; }
        .thread-empty { flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-faint);font-size:0.85rem;gap:0.4rem;text-align:center; }
        .thread-input-area { padding:0.85rem 1.25rem;border-top:1px solid var(--border);flex-shrink:0; }
        .thread-input-wrap { display:flex;align-items:flex-end;gap:0.5rem;background:var(--bg-hover);border:1.5px solid var(--border);border-radius:10px;padding:0.45rem 0.6rem;transition:border-color 0.15s; }
        .thread-input-wrap:focus-within { border-color:#4BACC6;background:var(--bg-surface);box-shadow:0 0 0 3px rgba(75,172,198,0.08); }
        .thread-input-wrap textarea { flex:1;background:transparent;border:none;outline:none;font-size:0.85rem;color:var(--text-primary);font-family:inherit;resize:none;min-height:20px;max-height:100px;line-height:1.5;padding:0.15rem 0; }
        .thread-input-wrap textarea::placeholder { color:var(--text-ghost); }
        .thread-send-btn { width:30px;height:30px;border-radius:7px;flex-shrink:0;background:#365F91;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:white;font-size:0.82rem;transition:background 0.12s; }
        .thread-send-btn:hover:not(:disabled) { background:#243F60; }
        .thread-send-btn:disabled { opacity:0.3;cursor:not-allowed; }
        .thread-input-hint { font-size:0.65rem;color:var(--text-ghost);margin-top:0.3rem; }

        @media(max-width:1100px) { .analytics-stats-grid{grid-template-columns:repeat(2,1fr)} .analytics-row{grid-template-columns:1fr} }
        @media(max-width:960px) { .db-sidebar{width:200px} .db-thread-panel{width:320px} }
        @media(max-width:768px) { .db-sidebar{display:none} .db-thread-panel{position:fixed;right:0;top:60px;bottom:0;width:100%;max-width:400px;z-index:300;box-shadow:-4px 0 20px rgba(0,0,0,0.12)} }
      `}</style>

      <div className="db">
        <Navbar fullName={profile?.full_name??null} role={profile?.role??'employee'} />

        <div className="db-shell">
          {/* ── Sidebar ── */}
          <div className="db-sidebar">
            <div className="db-sidebar-brand">
              <div className="db-sidebar-workspace">InfoWall</div>
              <div className="db-sidebar-sub">Enterprise Comms</div>
            </div>

            {/* My status */}
            <div className="db-status-bar" onClick={()=>setShowStatusMenu(o=>!o)} ref={statusMenuRef}>
              <div className="db-status-dot" style={{background:STATUS_COLORS[myStatus]}} />
              <span className="db-status-label">{STATUS_LABELS[myStatus]}</span>
              <span style={{color:'rgba(255,255,255,0.2)',fontSize:'0.65rem'}}>▾</span>
              {showStatusMenu && (
                <div className="db-status-menu" onClick={e=>e.stopPropagation()}>
                  {(['online','away','busy','offline'] as const).map(s => (
                    <div key={s} className="db-status-option" onClick={()=>{setMyStatus(s);setShowStatusMenu(false)}}>
                      <div className="db-status-dot" style={{background:STATUS_COLORS[s]}} />
                      <span className="db-status-option-label">{STATUS_LABELS[s]}</span>
                      {myStatus===s && <span style={{color:'rgba(255,255,255,0.4)',fontSize:'0.7rem',marginLeft:'auto'}}>✓</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="db-sidebar-scroll">
              {/* Channels */}
              <div className="db-channel-section">
                <span className="db-channel-label">Channels</span>
                {(['global','department','events'] as Channel[]).map(ch => {
                  const cfg = channelConfig[ch]
                  const pendingCount = ch==='global' ? mustReadPending.filter(p=>!p.department_id).length : 0
                  return (
                    <button key={ch} className={`db-channel-btn${channel===ch&&sideView==='feed'?' active':''}`}
                      onClick={()=>{setChannel(ch);setSideView('feed')}}>
                      <span className="db-channel-hash">{cfg.icon}</span>
                      <span className="db-channel-name">{cfg.label}</span>
                      {pendingCount>0 && <span className="db-channel-count">{pendingCount}</span>}
                    </button>
                  )
                })}
              </div>

              {/* Quick filters */}
              <div className="db-channel-section">
                <span className="db-channel-label">Quick Filters</span>
                {([
                  {id:'all',icon:'⬡',label:'All posts'},
                  {id:'mustread',icon:'⚠',label:'Must-read'},
                  {id:'polls',icon:'📊',label:'Polls'},
                  {id:'today',icon:'📅',label:'Today'},
                ] as const).map(f => (
                  <button key={f.id} className={`db-filter-chip${postFilter===f.id?' active':''}`}
                    onClick={()=>{setPostFilter(f.id);setSideView('feed')}}>
                    <span style={{fontSize:'0.78rem',opacity:0.7}}>{f.icon}</span>
                    <span>{f.label}</span>
                  </button>
                ))}
              </div>

              {/* Analytics */}
              <div className="db-channel-section">
                <span className="db-channel-label">Insights</span>
                <button className={`db-channel-btn analytics-btn${sideView==='analytics'?' active':''}`}
                  onClick={()=>setSideView('analytics')}>
                  <span className="db-channel-hash">📊</span>
                  <span className="db-channel-name">Analytics</span>
                </button>
              </div>

              {/* Online users */}
              <div className="db-online-section">
                <div className="db-online-header">
                  <span className="db-online-label">
                    Online now
                    {onlineCount>0&&<span className="db-online-count">{onlineCount}</span>}
                  </span>
                  <button className="db-online-toggle" onClick={()=>setShowOnlineList(o=>!o)}>
                    {showOnlineList?'▾':'▸'}
                  </button>
                </div>
                {showOnlineList && onlineUsers.slice(0,6).map(u => {
                  if (u.status==='offline') return null
                  return (
                    <div key={u.user_id} className="db-online-user" onClick={()=>navigate(`/profile/${u.user_id}`)}>
                      <div style={{position:'relative',flexShrink:0}}>
                        <div style={{width:22,height:22,borderRadius:'50%',background:'linear-gradient(135deg,#4F81BD,#243F60)',color:'white',fontSize:'0.5rem',fontWeight:800,display:'flex',alignItems:'center',justifyContent:'center'}}>
                          {initials(u.full_name)}
                        </div>
                        <div style={{position:'absolute',bottom:0,right:0,width:7,height:7,borderRadius:'50%',background:STATUS_COLORS[u.status],border:'1px solid #1A2B3C'}} />
                      </div>
                      <span className="db-online-user-name">{u.full_name?.split(' ')[0]??'Someone'}</span>
                      <span className="db-online-user-status">{STATUS_LABELS[u.status]}</span>
                    </div>
                  )
                })}
                {onlineCount===0&&<div style={{fontSize:'0.72rem',color:'rgba(255,255,255,0.2)',padding:'0.3rem 0.5rem'}}>No one else online</div>}
              </div>
            </div>

            <div className="db-sidebar-footer">
              <div className="db-sidebar-user" onClick={()=>profile&&navigate(`/profile/${profile.id}`)}>
                <Avatar name={profile?.full_name??null} size={30} role={profile?.role} online={true} />
                <div>
                  <span className="db-sidebar-name">{profile?.full_name?.split(' ')[0]??'You'}</span>
                  <span className="db-sidebar-role" style={{color:ROLE_COLORS[profile?.role??'']??'rgba(255,255,255,0.35)'}}>{profile?.role}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Main area ── */}
          <div className="db-main">

            {/* Topbar */}
            <div className="db-topbar">
              <div className="db-topbar-channel">
                <span>{sideView==='analytics'?'📊':channelConfig[channel].icon}</span>
                <span>{sideView==='analytics'?'Analytics':channelConfig[channel].label}</span>
              </div>
              {sideView==='feed'&&(
                <>
                  <div className="db-search-wrap">
                    <span style={{color:'var(--text-faint)',fontSize:'0.85rem'}}>🔍</span>
                    <input placeholder="Search posts…" value={search} onChange={e=>setSearch(e.target.value)} />
                    {search&&<button onClick={()=>setSearch('')} style={{background:'none',border:'none',color:'var(--text-faint)',cursor:'pointer',fontSize:'0.8rem'}}>✕</button>}
                  </div>
                  {canPost&&(
                    <button className="db-new-post-btn" onClick={()=>navigate('/create-post')}>✦ New post</button>
                  )}
                </>
              )}
            </div>

            {/* Filter bar */}
            {sideView==='feed'&&(
              <div className="db-filter-bar">
                {([
                  {id:'all',label:'All posts'},
                  {id:'mustread',label:'⚠ Must-read'},
                  {id:'polls',label:'📊 Polls'},
                  {id:'today',label:'📅 Today'},
                ] as const).map(f=>(
                  <button key={f.id} className={`pf-chip${postFilter===f.id?' active':''}`} onClick={()=>setPostFilter(f.id)}>{f.label}</button>
                ))}
                {(search||postFilter!=='all')&&(
                  <span className="pf-results">{filteredPosts.length} result{filteredPosts.length!==1?'s':''}</span>
                )}
              </div>
            )}

            {/* Stats bar */}
            <div className="db-stats-bar">
              <div className="db-stat">📢 <strong>{posts.length}</strong> posts</div>
              <div className="db-stat">⚠️ <strong>{mustReadPending.length}</strong> pending</div>
              <div className="db-stat">📊 <strong>{Object.keys(polls).length}</strong> polls</div>
              <div className="db-online-pill">
                <div className="db-online-pulse" />
                <strong>{onlineCount}</strong> online now
              </div>
            </div>

            {/* Must-read banner */}
            {mustReadPending.length>0&&sideView==='feed'&&(
              <div className="db-mustread-banner">
                <span style={{fontSize:'1rem'}}>⚠️</span>
                <span className="db-mustread-text">You have <strong>{mustReadPending.length}</strong> unacknowledged must-read {mustReadPending.length===1?'post':'posts'}</span>
                <button className="db-mustread-btn" onClick={()=>{setPostFilter('mustread');setSideView('feed')}}>View →</button>
              </div>
            )}

            <div className="db-content">
              {/* ── Analytics View ── */}
              {sideView==='analytics' ? (
                <AnalyticsView
                  posts={posts} reactions={reactions} acks={allAcks}
                  polls={polls} postViews={postViews}
                  profiles={allProfiles} departments={departments}
                />
              ) : (
                /* ── Post list ── */
                <div className="db-posts">
                  {grouped.length===0 ? (
                    <div className="db-empty">
                      <div style={{fontSize:'3rem',opacity:0.35}}>{channelConfig[channel].icon}</div>
                      <div style={{fontWeight:700,color:'var(--text-primary)',fontSize:'1rem'}}>
                        {search?'No posts match your search':`Nothing in ${channelConfig[channel].label} yet`}
                      </div>
                      {!search&&canPost&&(
                        <button onClick={()=>navigate('/create-post')} style={{padding:'0.55rem 1.25rem',background:'#243F60',color:'white',border:'none',borderRadius:'8px',font:'inherit',fontSize:'0.85rem',fontWeight:700,cursor:'pointer',marginTop:'0.5rem'}}>
                          Create first post
                        </button>
                      )}
                    </div>
                  ) : grouped.map(group => (
                    <div key={group.label}>
                      <div className="db-date-divider">
                        <div className="db-date-line" />
                        <div className="db-date-label">{group.label}</div>
                        <div className="db-date-line" />
                      </div>
                      {group.posts.map((post,idx) => {
                        const hasAck = !!acks.find(a=>a.post_id===post.id)
                        const postReactions = groupReactions(post.id)
                        const summary = generateSummary(post.content)
                        const isOwn = post.author_id===profile?.id
                        const canModify = isOwn||profile?.role==='admin'
                        const replyCount = commentCounts[post.id]??0
                        const isActiveThread = threadPost?.id===post.id
                        const dept = departments.find(d=>d.id===post.department_id)
                        const views = postViews[post.id]??0
                        const poll = polls[post.id]
                        const isOnline = onlineUserIds.has(post.author_id)

                        return (
                          <div key={post.id}
                            className={`db-post${post.must_read?(hasAck?' must-read-done':' must-read-pending'):''}`}
                            style={{animationDelay:`${idx*0.04}s`}}
                            onMouseEnter={()=>recordView(post.id)}
                          >
                            {canModify&&(
                              <div className="db-post-actions">
                                <button className="db-post-action-btn del" onClick={()=>deletePost(post.id)}>🗑</button>
                              </div>
                            )}

                            {/* Header */}
                            <div className="db-post-header">
                              <Avatar name={post.author?.full_name??null} size={38} role={post.author?.role} online={isOnline} />
                              <div className="db-post-meta">
                                <span className="db-post-author">{post.author?.full_name??'Unknown'}</span>
                                <span className="db-post-time">{timeAgo(post.created_at)}</span>
                                <div className="db-post-badges">
                                  <span className={`db-badge ${post.post_type==='news_event'?'db-badge-event':'db-badge-ann'}`}>
                                    {post.post_type==='news_event'?'📅 Event':'📢 Announcement'}
                                  </span>
                                  {post.must_read&&<span className="db-badge db-badge-must">⚠ Must-read</span>}
                                  {dept&&<span className="db-badge db-badge-dept">🏢 {dept.name}</span>}
                                  {poll&&<span className="db-badge db-badge-poll">📊 Poll</span>}
                                </div>
                              </div>
                              {views>0&&(
                                <div className="db-post-views">
                                  <span>👁</span><span>{views}</span>
                                </div>
                              )}
                            </div>

                            {/* Title */}
                            <div className="db-post-title">{post.title}</div>

                            {/* AI Summary */}
                            {summary&&(
                              <div className="db-ai-summary">
                                <span className="db-ai-icon">✦</span>
                                <div><span className="db-ai-label">Summary</span><span className="db-ai-text">{summary}</span></div>
                              </div>
                            )}

                            {/* Content */}
                            {post.content&&<div className="db-post-content">{post.content}</div>}

                            {/* Poll */}
                            {poll&&(
                              <PollCard
                                poll={poll.question}
                                options={poll.options}
                                votes={poll.votes}
                                userId={profile?.id??null}
                                onVote={optId=>votePoll(poll.question.id,post.id,optId)}
                                onUnvote={optId=>unvotePoll(poll.question.id,post.id,optId)}
                              />
                            )}

                            {/* Event dates */}
                            {post.post_type==='news_event'&&post.event_start&&(
                              <div className="db-event-card">
                                <span style={{fontSize:'1.1rem'}}>📅</span>
                                <div>
                                  <div className="db-event-date">{fmtEventDate(post.event_start)}</div>
                                  {post.event_end&&<div style={{fontSize:'0.75rem',color:'#9CA3AF'}}>Ends {fmtEventDate(post.event_end)}</div>}
                                </div>
                              </div>
                            )}

                            {/* Attachment */}
                            {post.attachment_url&&(
                              <img className="db-post-image" src={post.attachment_url} alt="" loading="lazy" onError={e=>{(e.currentTarget as HTMLImageElement).style.display='none'}} />
                            )}

                            {/* Footer */}
                            <div className="db-post-footer" style={{position:'relative'}}>
                              <div className="db-reactions-row">
                                {postReactions.map(r=>(
                                  <div key={r.emoji} style={{position:'relative'}}>
                                    <button
                                      className={`db-reaction-pill${r.iMine?' mine':''}`}
                                      onClick={()=>toggleReaction(post.id,r.emoji)}
                                      onMouseEnter={()=>setShowReactorsFor(`${post.id}:${r.emoji}`)}
                                      onMouseLeave={()=>setShowReactorsFor(null)}
                                    >
                                      {r.emoji}
                                      {r.count>1&&<span className="db-reaction-count">{r.count}</span>}
                                      {showReactorsFor===`${post.id}:${r.emoji}`&&r.reactors.length>0&&(
                                        <div className="reactors-tooltip">
                                          {r.reactors.slice(0,4).join(', ')}{r.reactors.length>4?` +${r.reactors.length-4} more`:''}
                                        </div>
                                      )}
                                    </button>
                                  </div>
                                ))}
                                <div style={{position:'relative'}}>
                                  <button className="emoji-trigger-db" onClick={()=>setShowEmojiFor(showEmojiFor===post.id?null:post.id)}>😊</button>
                                  {showEmojiFor===post.id&&(
                                    <div className="emoji-picker-db">
                                      {QUICK_EMOJIS.map(emoji=>(
                                        <button key={emoji} className="emoji-btn-db" onClick={()=>toggleReaction(post.id,emoji)}>{emoji}</button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Thread button */}
                              <button className={`db-thread-btn${replyCount>0?' has-replies':''}`}
                                onClick={()=>isActiveThread?setThreadPost(null):openThread(post)}>
                                💬 {replyCount>0?`${replyCount} ${replyCount===1?'reply':'replies'}`:'Reply'}
                              </button>

                              {/* Must-read ack */}
                              {post.must_read&&(
                                <button className={`db-ack-btn${hasAck?' done':' pending'}`} onClick={()=>toggleAck(post.id)}>
                                  {hasAck?'✓ Acknowledged':'⚠ Mark as read'}
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}

              {/* ── Thread Panel ── */}
              {threadPost&&sideView==='feed'&&(
                <div className="db-thread-panel">
                  <div className="thread-header">
                    <div className="thread-title">
                      <span>💬</span> Thread
                      {(commentCounts[threadPost.id]??0)>0&&(
                        <span style={{fontSize:'0.72rem',background:'#EEF4FB',color:'#365F91',borderRadius:'999px',padding:'0.1rem 0.5rem',fontWeight:700}}>
                          {commentCounts[threadPost.id]}
                        </span>
                      )}
                    </div>
                    <button className="thread-close" onClick={()=>setThreadPost(null)}>✕</button>
                  </div>

                  <div className="thread-orig">
                    <div style={{display:'flex',alignItems:'center',gap:'0.5rem',marginBottom:'0.5rem'}}>
                      <Avatar name={threadPost.author?.full_name??null} size={24} role={threadPost.author?.role}
                        online={onlineUserIds.has(threadPost.author_id)} />
                      <span style={{fontSize:'0.8rem',fontWeight:700,color:'var(--text-primary)'}}>{threadPost.author?.full_name}</span>
                    </div>
                    <div className="thread-orig-title">{threadPost.title}</div>
                    {threadPost.content&&<div className="thread-orig-content">{threadPost.content}</div>}
                    <div className="thread-orig-meta">{fmtDate(threadPost.created_at)} at {fmtTime(threadPost.created_at)}</div>
                  </div>

                  <div className="thread-comments">
                    {loadingThread ? (
                      <div style={{textAlign:'center',color:'var(--text-faint)',padding:'2rem',fontSize:'0.85rem',animation:'pulse2 1.5s ease-in-out infinite'}}>Loading replies…</div>
                    ) : threadComments.length===0 ? (
                      <div className="thread-empty">
                        <div style={{fontSize:'1.75rem',opacity:0.35}}>💬</div>
                        <div style={{fontWeight:600,color:'var(--text-primary)'}}>No replies yet</div>
                        <div style={{fontSize:'0.78rem'}}>Be the first to reply</div>
                      </div>
                    ) : threadComments.map((comment,i) => {
                      const isMyComment = comment.author_id===profile?.id
                      const isDeleting = deletingCommentId===comment.id
                      const isOnline = onlineUserIds.has(comment.author_id)
                      return (
                        <div key={comment.id} className="thread-comment" style={{animationDelay:`${i*0.04}s`,opacity:isDeleting?0.4:1}}>
                          <Avatar name={comment.author?.full_name??null} size={28} role={comment.author?.role} online={isOnline} />
                          <div className="thread-comment-body">
                            <div className="thread-comment-header">
                              <span className="thread-comment-name">{comment.author?.full_name??'Unknown'}</span>
                              <span className="thread-comment-time">{timeAgo(comment.created_at)}</span>
                              {isMyComment&&(
                                <button className="thread-comment-del" onClick={()=>deleteComment(comment.id,threadPost.id)} disabled={isDeleting}>🗑</button>
                              )}
                            </div>
                            <div className="thread-comment-text">{comment.content}</div>
                          </div>
                        </div>
                      )
                    })}
                    <div ref={threadEndRef} />
                  </div>

                  <div className="thread-input-area">
                    <div className="thread-input-wrap">
                      <textarea
                        ref={threadInputRef}
                        rows={1}
                        placeholder="Reply to thread…"
                        value={threadInput}
                        onChange={e=>{setThreadInput(e.target.value);e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,100)+'px'}}
                        onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendComment()}}}
                      />
                      <button className="thread-send-btn" onClick={sendComment} disabled={!threadInput.trim()||sendingComment}>➤</button>
                    </div>
                    <div className="thread-input-hint">Enter to send · Shift+Enter for new line</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}