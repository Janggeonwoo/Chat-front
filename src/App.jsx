import React, { useState, useEffect, useRef } from 'react';
import SockJS from 'sockjs-client';
import Stomp from 'stompjs';

// 👑 카카오 앱 설정 값
const KAKAO_REST_API_KEY = "429780ef9d280c4afe7412483ee639ff";
const KAKAO_REDIRECT_URI = "http://localhost:8080/api/auth/kakao";
const KAKAO_AUTH_URL = `https://kauth.kakao.com/oauth/authorize?client_id=${KAKAO_REST_API_KEY}&redirect_uri=${KAKAO_REDIRECT_URI}&response_type=code`;

function App() {
  // ─── 상태 관리 세트 ───
  // AUTH: 일반로그인창, SIGNUP_INTRO: 카카오인증 유도방, NICKNAME_SETTING: 인증성공 후 ID/PW생성방, IDLE: 로비대기실
  const [status, setStatus] = useState('AUTH'); 
  const [normalId, setNormalId] = useState(''); // 일반 로그인 입력용 ID
  const [normalPw, setNormalPw] = useState(''); // 일반 로그인 입력용 PW
  
  const [newId, setNewId] = useState('');       // 신규 가입 생성용 ID
  const [newPw, setNewPw] = useState('');       // 신규 가입 생성용 PW
  const [nickname, setNickname] = useState('');
  const [userKey, setUserKey] = useState('');
  const [kakaoId, setKakaoId] = useState('');   // 카카오 고유 ID 보관용
  
  const [roomId, setRoomId] = useState('');      
  const [messages, setMessages] = useState([]); 
  const [input, setInput] = useState('');       

  // 🤝 친구 및 탭/어드민 상태 주머니
  const [opponentKey, setOpponentKey] = useState('');
  const [opponentNickname, setOpponentNickname] = useState('');
  const [friendList, setFriendList] = useState([]);      
  const [pendingFriends, setPendingFriends] = useState([]); 
  const [currentTab, setCurrentTab] = useState('MATCH'); 
  const [adminReports, setAdminReports] = useState([]); 
  const [isAdmin, setIsAdmin] = useState(false);      
  const [isOpponentTyping, setIsOpponentTyping] = useState(false); 
  const [activeImg, setActiveImg] = useState(null);

  const typingTimeoutRef = useRef(null); 
  const stompClientRef = useRef(null); 
  const fileInputRef = useRef(null); 
  const messageEndRef = useRef(null); 

  // 자동 스크롤 하단 고정
  useEffect(() => {
    if (messageEndRef.current) {
      messageEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpponentTyping]);

  // 1. 컴포넌트 로드 시 로컬 스토리지 자동 로그인 체크 및 백엔드가 보낸 가입 신호 감지
  useEffect(() => {
    // A. 기존 로그인 이력이 있는지 확인
    const savedKey = localStorage.getItem('rantalk_user_key');
    const savedNickname = localStorage.getItem('rantalk_nickname');
    if (savedKey && savedNickname) {
      setNickname(savedNickname);
      setUserKey(savedKey);
      setIsAdmin(savedNickname.startsWith('[운영자]'));
      setStatus('IDLE'); 
      return;
    }

    // B. 주소창 파라미터 분석
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const backendStatus = params.get('status');
    const backendKakaoId = params.get('kakaoId');
    const backendNickname = params.get('defaultNickname');

    // 👇 백엔드가 카카오 인증 성공 후 가입 정보를 주소창에 실어 보냈다면 바로 아이디 생성 창으로 진입!
    if (backendStatus === 'SIGNUP_REQUIRED') {
      setKakaoId(backendKakaoId);
      setNickname(decodeURIComponent(backendNickname || ''));
      setStatus('NICKNAME_SETTING'); // 아이디/비밀번호 입력 창으로 강제 고정!
      window.history.replaceState({}, null, window.location.pathname); // 주소창 청소
      return;
    }
    
    // C. 최초 카카오 로그인 시 인가 코드 감지 처리
    if (code) {
      processKakaoLogin(code);
    }
  }, []);

  // 로비 대기실일 때 친구 데이터 주기적 갱신
  useEffect(() => {
    if (status === 'IDLE' && userKey) {
      fetchFriendData();
    }
  }, [status, userKey]);

  // ─── 일반 아이디/비밀번호 로그인 처리 ───
  const handleNormalLogin = async (e) => {
    e.preventDefault();
    if (!normalId.trim() || !normalPw.trim()) return;

    try {
      const response = await fetch('http://localhost:8080/api/auth/login/normal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: normalId, userPw: normalPw })
      });

      if (!response.ok) throw new Error("로그인 정보가 일치하지 않습니다.");
      const data = await response.json();

      localStorage.setItem('rantalk_user_key', data.userKey);
      localStorage.setItem('rantalk_nickname', data.nickname);
      setUserKey(data.userKey);
      setNickname(data.nickname);
      setIsAdmin(data.nickname.startsWith('[운영자]'));
      setStatus('IDLE');
    } catch (error) {
      alert(error.message);
    }
  };

  // ─── 카카오 로그인/인증 처리 코어 로직 ───
  const processKakaoLogin = async (code) => {
    try {
      const response = await fetch(`http://localhost:8080/api/auth/kakao?code=${code}`);
      if (!response.ok) throw new Error("카카오 인증 실패");
      
      const data = await response.json();
      
      if (data.status === 'SIGNUP_REQUIRED') {
        setKakaoId(data.kakaoId);
        setNickname(data.defaultNickname || ''); 
        setStatus('NICKNAME_SETTING');
      } else if (data.status === 'LOGIN_SUCCESS') {
        localStorage.setItem('rantalk_user_key', data.userKey);
        localStorage.setItem('rantalk_nickname', data.nickname);
        setUserKey(data.userKey);
        setNickname(data.nickname);
        setIsAdmin(data.nickname.startsWith('[운영자]'));
        setStatus('IDLE');
      }
    } catch (error) {
      console.error("카카오 인증 중 오류 발생:", error);
      alert("카카오 본인인증에 실패했습니다. 다시 시도해주세요.");
      setStatus('AUTH');
    }
  };

  // ─── 신규 유저 최종 회원가입 (아이디, 비밀번호, 닉네임 설정 완료) ───
  const handleFinalSignup = async (e) => {
    e.preventDefault();
    if (!newId.trim() || !newPw.trim() || !nickname.trim()) return;

    try {
      // 주소 충돌을 우회하기 위해 정렬한 백엔드 전용 엔드포인트(/signup/final) 호출
      const response = await fetch('http://localhost:8080/api/auth/signup/final', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // ⭕ 완벽 교정: 생략된 부분을 지우고 화면에서 받아온 알맹이 값들을 묶어 백엔드로 토스합니다.
        body: JSON.stringify({ 
          kakaoId: kakaoId, 
          userId: newId, 
          userPw: newPw, 
          nickname: nickname 
        }),
      });

      if (!response.ok) throw new Error("가입 처리 실패");
      const data = await response.json();
      
      alert('회원가입이 정상 완료되었습니다!\n방금 만드신 계정으로 로그인해 주세요.');
      
      // 입력 폼 초기화 후 다시 일반 로그인 메인 화면으로 바운스
      setNewId('');
      setNewPw('');
      setStatus('AUTH'); 
    } catch (error) {
      console.error('회원가입 실패:', error);
      alert('이미 존재하는 아이디거나 가입 처리 중 오류가 발생했습니다.');
    }
  };

  // 로그아웃 (스토리지 비우고 초기화)
  const handleLogout = () => {
    localStorage.removeItem('rantalk_user_key');
    localStorage.removeItem('rantalk_nickname');
    setUserKey('');
    setNickname('');
    setKakaoId('');
    setNormalId('');
    setNormalPw('');
    setStatus('AUTH');
  };

  // ─── [기존 비즈니스 함수 보존 어레이] ───
  const fetchFriendData = async () => {
    if (!userKey) return;
    try {
      const pendingRes = await fetch(`http://localhost:8080/api/friends/pending/${userKey}`);
      if (pendingRes.ok) setPendingFriends(await pendingRes.json());
      const listRes = await fetch(`http://localhost:8080/api/friends/list/${userKey}`);
      if (listRes.ok) setFriendList(await listRes.json());
    } catch (error) { console.error("친구 로드 실패:", error); }
  };

  const fetchAdminReports = async () => {
    try {
      const res = await fetch('http://localhost:8080/api/reports/admin/list');
      if (res.ok) setAdminReports(await res.json());
    } catch (error) { console.error("신고 내역 로드 실패:", error); }
  };

  const handleUnbanUser = async (targetKey) => {
    if (!window.confirm("정말 이 유저의 정지를 해제하시겠습니까?")) return;
    try {
      const res = await fetch(`http://localhost:8080/api/reports/admin/unban/${targetKey}`, { method: 'DELETE' });
      if (res.ok) { alert("정지가 해제되었습니다!"); fetchAdminReports(); }
    } catch (error) { console.error("정지 해제 실패:", error); }
  };

  const startMatch = async () => {
    try {
      const banCheckRes = await fetch(`http://localhost:8080/api/reports/check-ban/${userKey}`);
      if (banCheckRes.ok) {
        const banData = await banCheckRes.json();
        if (banData.isBanned) {
          alert(`🚫 이용이 제한된 계정입니다.\n\n사유: 누적 ${banData.reportCount}회 이상 신고 접수됨.`);
          setStatus('IDLE'); return; 
        }
      }
    } catch (error) { console.error("밴 확인 실패:", error); }

    setStatus('MATCHING');
    const socket = new SockJS('http://localhost:8080/ws-chat');
    const stompClient = Stomp.over(socket);

    stompClient.connect({}, () => {
      stompClientRef.current = stompClient;
      const rawUrl = socket._transport.url;
      const urlParts = rawUrl.split('/');
      const mySessionId = urlParts[urlParts.length - 2]; 

      stompClient.subscribe(`/queue/match/${mySessionId}`, async (response) => {
        const data = JSON.parse(response.body);
        setRoomId(data.roomId); setOpponentKey(data.opponentKey); setOpponentNickname(data.opponentNickname); 
        setStatus('CHATTING'); 

        try {
          const historyResponse = await fetch(`http://localhost:8080/api/chat/room/${data.roomId}/messages`);
          if (historyResponse.ok) setMessages(await historyResponse.json());
        } catch (err) { console.error("역사 로딩 실패:", err); }

        stompClient.subscribe(`/sub/chatroom/${data.roomId}`, (chatResponse) => {
          setMessages((prev) => [...prev, JSON.parse(chatResponse.body)]);
          setIsOpponentTyping(false); 
        });

        stompClient.subscribe(`/sub/chatroom/${data.roomId}/typing`, (typeResponse) => {
          const typeData = JSON.parse(typeResponse.body);
          if (typeData.sender !== nickname) setIsOpponentTyping(typeData.isTyping);
        });
      });

      stompClient.send('/pub/match/join', { nickname: nickname, userKey: userKey }, JSON.stringify({}));
    }, (error) => { setStatus('IDLE'); });
  };

  const handleCancelMatch = () => {
    if (stompClientRef.current) {
      stompClientRef.current.send('/pub/match/cancel', {}, JSON.stringify({}));
      stompClientRef.current.disconnect();
    }
    setStatus('IDLE');
  };

  const handleStartFriendChat = async (friendshipId, friendName) => {
    try {
      const response = await fetch(`http://localhost:8080/api/friends/room/${friendshipId}`);
      const data = await response.json();
      setRoomId(data.roomId); setOpponentNickname(friendName); setOpponentKey(''); setMessages([]);

      const socket = new SockJS('http://localhost:8080/ws-chat');
      const stompClient = Stomp.over(socket);

      stompClient.connect({}, () => {
        stompClientRef.current = stompClient; setStatus('CHATTING'); 
        fetch(`http://localhost:8080/api/chat/room/${data.roomId}/messages`).then(res => res.json()).then(m => setMessages(m));
        stompClient.subscribe(`/sub/chatroom/${data.roomId}`, (res) => setMessages((prev) => [...prev, JSON.parse(res.body)]));
      });
    } catch (e) { console.error(e); }
  };

  const handleRequestFriend = async () => {
    if (!opponentKey || opponentKey === 'unknown_key') return alert("대화방에서만 신청 가능합니다.");
    try {
      const response = await fetch('http://localhost:8080/api/friends/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requesterKey: userKey, receiverKey: opponentKey, requesterNickname: nickname, receiverNickname: opponentNickname })
      });
      alert(response.ok ? `${opponentNickname}님에게 친구 신청을 보냈습니다!` : await response.text());
    } catch (e) {}
  };

  const handleReportUser = async () => {
    if (!opponentKey) return;
    const reason = window.prompt("🚨 신고 사유를 입력해주세요.");
    if (!reason || !reason.trim()) return;
    try {
      const response = await fetch('http://localhost:8080/api/reports/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reporterKey: userKey, targetKey: opponentKey, reason: reason })
      });
      if (response.ok) { alert("신고 접수 완료. 즉시 재매칭합니다."); handleRematch(); }
    } catch (e) {}
  };

  const handleRespondFriend = async (friendshipId, action) => {
    try {
      const response = await fetch('http://localhost:8080/api/friends/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendshipId, action })
      });
      if (response.ok) { alert("처리 완료"); fetchFriendData(); }
    } catch (e) {}
  };

  const handleDeleteFriend = async (friendshipId, friendName) => {
    if (!window.confirm(`${friendName}님과 절교하시겠습니까?`)) return;
    try {
      if ((await fetch(`http://localhost:8080/api/friends/delete/${friendshipId}`, { method: 'DELETE' })).ok) fetchFriendData();
    } catch (e) {}
  };

  const sendMessage = (e) => {
    e.preventDefault(); if (!input.trim() || !stompClientRef.current) return;
    stompClientRef.current.send(`/pub/message/${roomId}`, {}, JSON.stringify({ roomId, sender: nickname, content: input, type: 'TEXT' }));
    setInput('');
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const formData = new FormData(); formData.append('file', file);
    try {
      const url = await (await fetch('http://localhost:8080/api/chat/upload', { method: 'POST', body: formData })).text();
      stompClientRef.current.send(`/pub/message/${roomId}`, {}, JSON.stringify({ roomId, sender: nickname, content: url, type: 'IMAGE' }));
    } catch (e) {}
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
    if (stompClientRef.current) stompClientRef.current.send(`/pub/message/${roomId}/typing`, {}, JSON.stringify({ sender: nickname, isTyping: true }));
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => stompClientRef.current.send(`/pub/message/${roomId}/typing`, {}, JSON.stringify({ sender: nickname, isTyping: false })), 1500);
  };

  const handleLeaveRoom = () => {
    if (stompClientRef.current) { stompClientRef.current.send('/pub/match/leave', {}, {}); stompClientRef.current.disconnect(); }
    setRoomId(''); setMessages([]); setOpponentKey(''); setOpponentNickname(''); setStatus('IDLE');
  };

  const handleRematch = () => {
    if (stompClientRef.current) { stompClientRef.current.send('/pub/match/leave', {}, {}); stompClientRef.current.disconnect(); }
    setRoomId(''); setMessages([]); setOpponentKey(''); setOpponentNickname(''); startMatch();
  };

  // ─── 공통 스타일 레이아웃 ───
  const cardStyle = { background: '#fff', padding: '35px 25px', borderRadius: '16px', boxShadow: '0 8px 24px rgba(0,0,0,0.06)', width: '100%', maxWidth: '430px', margin: '40px auto', boxSizing: 'border-box', position: 'relative', minHeight: '520px', display: 'flex', flexDirection: 'column' };
  const btnPrimary = { width: '100%', padding: '14px', background: '#4F46E5', color: 'white', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' };
  const inputStyle = { padding: '14px', fontSize: '15px', border: '1px solid #ddd', borderRadius: '8px', outline: 'none', width: '100%', boxSizing: 'border-box' };

  // ─── [컴포넌트 화면 출력 분기 컨트롤] ───

  // [화면 1] AUTH: 기본 로그인 메인 화면 (아이디/패스워드)
  if (status === 'AUTH') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', height: '100vh', background: '#f4f6fa' }}>
        <div style={{ ...cardStyle, justifyContent: 'center' }}>
          <h2 style={{ fontSize: '26px', fontWeight: '800', color: '#333', textAlign: 'center', margin: '0 0 8px 0' }}>📱 란톡 로그인</h2>
          <p style={{ color: '#888', fontSize: '14px', textAlign: 'center', marginBottom: '30px' }}>생성한 정보로 란톡 시스템에 접속합니다</p>
          
          <form onSubmit={handleNormalLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <input type="text" placeholder="아이디 입력" value={normalId} onChange={(e) => setNormalId(e.target.value)} style={inputStyle} required />
            <input type="password" placeholder="비밀번호 입력" value={normalPw} onChange={(e) => setNormalPw(e.target.value)} style={inputStyle} required />
            <button type="submit" style={btnPrimary}>란톡 접속하기</button>
          </form>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', fontSize: '13px', color: '#666', marginTop: '25px' }}>
            <span>아직 계정이 없으신가요?</span>
            <button onClick={() => setStatus('SIGNUP_INTRO')} style={{ background: 'none', border: 'none', color: '#4F46E5', fontWeight: 'bold', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>회원가입</button>
          </div>
        </div>
      </div>
    );
  }

  // [화면 2] SIGNUP_INTRO: 회원가입 클릭 시 진입하는 카카오 본인 인증 대기실
  if (status === 'SIGNUP_INTRO') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', height: '100vh', background: '#f4f6fa' }}>
        <div style={{ ...cardStyle, justifyContent: 'center', textAlign: 'center' }}>
          <h3 style={{ fontSize: '22px', fontWeight: '700', color: '#333', margin: '0 0 10px 0' }}>란톡 회원가입</h3>
          <p style={{ color: '#666', fontSize: '14px', marginBottom: '40px', lineHeight: '1.5' }}>안전하고 클린한 채팅 환경을 위해<br/>먼저 카카오톡 본인 인증을 진행해주세요.</p>
          
          <a href={KAKAO_AUTH_URL} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', width: '100%', padding: '15px 0', background: '#FEE500', color: '#191919', borderRadius: '12px', fontSize: '16px', fontWeight: 'bold', textDecoration: 'none', boxShadow: '0 4px 12px rgba(254,229,0,0.3)' }}>
            <span style={{ fontSize: '18px' }}>💛</span> 카카오톡으로 인증하기
          </a>

          <button onClick={() => setStatus('AUTH')} style={{ background: 'none', border: 'none', color: '#999', marginTop: '25px', cursor: 'pointer', fontSize: '13px' }}>돌아가기</button>
        </div>
      </div>
    );
  }

  // [화면 3] NICKNAME_SETTING: 카카오 인증 성공 상태로 진입하는 계정 아이디/비번 빌드 화면
  if (status === 'NICKNAME_SETTING') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', height: '100vh', background: '#f4f6fa' }}>
        <div style={cardStyle}>
          <h3 style={{ fontSize: '20px', fontWeight: '700', color: '#333', margin: '0 0 4px 0', textAlign: 'center' }}>계정 생성 단계</h3>
          <p style={{ color: '#22C55E', fontSize: '13px', marginBottom: '25px', textAlign: 'center', fontWeight: 'bold' }}>✓ 카카오 본인 확인 완료</p>
          
          <form onSubmit={handleFinalSignup} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#555', marginBottom: '5px' }}>란톡 사용할 아이디</label>
              <input type="text" placeholder="새로운 아이디 입력" value={newId} onChange={(e) => setNewId(e.target.value)} style={inputStyle} required />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#555', marginBottom: '5px' }}>비밀번호 설정</label>
              <input type="password" placeholder="새로운 비밀번호 입력" value={newPw} onChange={(e) => setNewPw(e.target.value)} style={inputStyle} required />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#555', marginBottom: '5px' }}>활동 닉네임 (변경 가능)</label>
              <input type="text" placeholder="활동 닉네임 입력" value={nickname} onChange={(e) => setNickname(e.target.value)} style={inputStyle} required />
            </div>

            <button type="submit" style={{ ...btnPrimary, marginTop: '15px' }}>회원가입 완료하기</button>
          </form>
        </div>
      </div>
    );
  }

  // [화면 4] IDLE: 대기실/로비
  if (status === 'IDLE') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', minHeight: '100vh', background: '#f4f6fa', padding: '20px 0' }}>
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid #f4f6fa', paddingBottom: '10px' }}>
            <span style={{ fontSize: '14px', color: '#666' }}>👋 <b style={{ color: isAdmin ? '#dc3545' : '#4F46E5' }}>{nickname}</b>님</span>
            <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: '#999', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' }}>로그아웃</button>
          </div>

          {currentTab === 'MATCH' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingBottom: '60px' }}>
              <div style={{ textAlign: 'center', margin: '20px 0' }}>
                <div style={{ textAlign: 'center', fontSize: '50px' }}>🎲</div>
                <h3 style={{ textAlign: 'center', margin: '15px 0 5px 0', color: '#333' }}>랜덤 매칭</h3>
                <p style={{ textAlign: 'center', color: '#888', fontSize: '13px', margin: '0 0 25px 0' }}>카카오 인증이 완료된 유저 그룹과 즉시 매칭합니다.</p>
              </div>
              <button onClick={startMatch} style={{ ...btnPrimary, fontSize: '17px', padding: '16px' }}>🎲 랜덤 매칭 시작하기</button>
              {isAdmin && <button onClick={() => { fetchAdminReports(); setStatus('ADMIN'); }} style={{ marginTop: '20px', width: '100%', padding: '10px', background: '#343a40', color: 'white', border: 'none', borderRadius: '8px', fontSize: '12px', cursor: 'pointer' }}>🛠️ 백오피스 관제시스템 진입</button>}
            </div>
          )}

          {currentTab === 'FRIEND' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', paddingBottom: '60px' }}>
              {pendingFriends.length > 0 && (
                <div style={{ background: '#fff9e6', padding: '12px', borderRadius: '10px', marginBottom: '15px', border: '1px solid #ffeeba' }}>
                  <h5 style={{ margin: '0 0 8px 0', color: '#856404', fontSize: '12px' }}>🔔 도착한 친구 요청</h5>
                  {pendingFriends.map((f) => (
                    <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', marginBottom: '6px' }}>
                      <span><b>{f.requesterNickname}</b>님</span>
                      <div>
                        <button onClick={() => handleRespondFriend(f.id, 'ACCEPT')} style={{ background: '#00c73c', color: '#fff', border: 'none', padding: '3px 8px', borderRadius: '4px', marginRight: '4px', fontSize: '11px', cursor: 'pointer' }}>수락</button>
                        <button onClick={() => handleRespondFriend(f.id, 'REJECT')} style={{ background: '#6c757d', color: '#fff', border: 'none', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}>거절</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#555' }}>👥 내 인맥 ({friendList.length}명)</h4>
              {friendList.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#bbb', minHeight: '180px' }}>👤<p style={{ fontSize: '13px', margin: 0 }}>등록된 친구가 없습니다.</p></div>
              ) : (
                <div style={{ maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {friendList.map((f) => {
                    const friendName = f.requesterKey === userKey ? f.receiverNickname : f.requesterNickname;
                    return (
                      <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: '#f8f9fa', borderRadius: '10px', border: '1px solid #f1f3f5' }}>
                        <div onClick={() => handleStartFriendChat(f.id, friendName)} style={{ cursor: 'pointer', flex: 1, fontSize: '14px', color: '#333' }}>🟢 <b>{friendName}</b> <span style={{ fontSize: '11px', color: '#4F46E5', marginLeft: '6px' }}>[채팅]</span></div>
                        <button onClick={() => handleDeleteFriend(f.id, friendName)} style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: '12px' }}>삭제</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', borderTop: '1px solid #eee', background: '#fff', position: 'absolute', bottom: '0', left: '0', width: '100%', borderRadius: '0 0 16px 16px' }}>
            <button onClick={() => setCurrentTab('MATCH')} style={{ flex: 1, padding: '14px 0', textAlign: 'center', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold', border: 'none', background: 'transparent', color: currentTab === 'MATCH' ? '#4F46E5' : '#aaa', borderBottom: currentTab === 'MATCH' ? '3px solid #4F46E5' : '3px solid transparent' }}>💬<br/>매칭/홈</button>
            <button onClick={() => setCurrentTab('FRIEND')} style={{ flex: 1, padding: '14px 0', textAlign: 'center', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold', border: 'none', background: 'transparent', color: currentTab === 'FRIEND' ? '#4F46E5' : '#aaa', borderBottom: currentTab === 'FRIEND' ? '3px solid #4F46E5' : '3px solid transparent' }}>👥<br/>친구 ({friendList.length})</button>
          </div>
        </div>
      </div>
    );
  }

  // [화면 5] MATCHING
  if (status === 'MATCHING') {
    return (
      <div style={{ padding: '50px', display: 'flex', alignItems: 'center', height: '100vh', background: '#f4f6fa' }}>
        <div style={{ ...cardStyle, textAlign: 'center', justifyContent: 'center', minHeight: '35px' }}>
          <h3 style={{ margin: '0 0 10px 0', fontSize: '20px' }}>🔍 상대를 탐색하고 있습니다</h3>
          <div style={{ margin: '30px auto', width: '44px', height: '44px', border: '4px solid #f3f3f3', borderTop: '4px solid #4F46E5', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
          <button onClick={handleCancelMatch} style={{ ...btnPrimary, background: '#6c757d', padding: '12px', fontSize: '14px' }}>매칭 취소</button>
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  // [화면 6] ADMIN
  if (status === 'ADMIN') {
    return (
      <div style={{ padding: '30px', maxWidth: '800px', margin: '40px auto', background: '#fff', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #eee', paddingBottom: '15px', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '20px' }}>🛠️ 어드민 관제 센터</h2>
          <button onClick={() => setStatus('IDLE')} style={{ padding: '6px 14px', background: '#6c757d', color: '#fff', border: 'none', borderRadius: '4px' }}>로비 복귀</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead><tr style={{ background: '#f8f9fa' }}><th style={{ padding: '10px', textAlign: 'left' }}>피신고자</th><th style={{ padding: '10px', textAlign: 'left' }}>사유</th><th style={{ padding: '10px', textAlign: 'center' }}>조치</th></tr></thead>
          <tbody>
            {adminReports.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '10px', color: '#dc3545' }}>{r.targetKey.substring(0,12)}...</td>
                <td style={{ padding: '10px' }}>{r.reason}</td>
                <td style={{ padding: '10px', textAlign: 'center' }}><button onClick={() => handleUnbanUser(r.targetKey)} style={{ background: '#4F46E5', color: 'white', border: 'none', padding: '3px 8px', borderRadius: '4px' }}>🔓 해제</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // [화면 7] CHATTING 실시간 채팅방 화면 
  return (
    <div style={{ maxWidth: '480px', margin: '0 auto', height: '100vh', display: 'flex', flexDirection: 'column', background: '#b2c7da', boxSizing: 'border-box' }}>
      <div style={{ background: '#fff', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', zIndex: 10 }}>
        <div><span style={{ fontSize: '15px', fontWeight: 'bold', color: '#333' }}>🟢 {opponentNickname}</span></div>
        <div style={{ display: 'flex', gap: '5px' }}>
          {opponentKey && (
            <>
              <button onClick={handleRematch} style={{ padding: '6px 10px', background: '#FF9800', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold' }}>⚡ 다음 상대</button>
              <button onClick={handleRequestFriend} style={{ padding: '6px 10px', background: '#00c73c', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold' }}>🤝 친구</button>
              <button onClick={handleReportUser} style={{ padding: '6px 10px', background: '#fff', color: '#dc3545', border: '1px solid #dc3545', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold' }}>🚨 신고</button>
            </>
          )}
          <button onClick={handleLeaveRoom} style={{ padding: '6px 10px', background: '#888', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold' }}>나가기</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {messages.map((msg, index) => {
          const isMe = msg.sender === nickname;
          const isSystem = msg.sender === '시스템';
          if (isSystem) return (<div key={index} style={{ textAlign: 'center', margin: '8px 0' }}><span style={{ background: 'rgba(0,0,0,0.15)', color: '#fff', padding: '4px 10px', borderRadius: '12px', fontSize: '12px' }}>{msg.content}</span></div>);

          return (
            <div key={index} style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
              {!isMe && <span style={{ fontSize: '11px', color: '#555', marginBottom: '3px' }}>{msg.sender}</span>}
              <div style={{ background: isMe ? '#fee500' : '#fff', color: '#333', padding: '10px 14px', borderRadius: isMe ? '14px 0 14px 14px' : '0 14px 14px 14px', fontSize: '14px', boxShadow: '0 1px 2px rgba(0,0,0,0.1)', maxWidth: '75%', wordBreak: 'break-all' }}>
                {msg.type === 'IMAGE' ? <img src={msg.content} alt="전송 사진" onClick={() => setActiveImg(msg.content)} style={{ maxWidth: '100%', borderRadius: '6px', cursor: 'pointer' }} /> : msg.content}
              </div>
            </div>
          );
        })}
        {isOpponentTyping && <div style={{ alignSelf: 'flex-start', background: 'rgba(255,255,255,0.7)', padding: '6px 12px', borderRadius: '12px', fontSize: '12px' }}>💬 입력하는 중...</div>}
        <div ref={messageEndRef} />
      </div>

      <div style={{ background: '#fff', padding: '10px 12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageUpload} style={{ display: 'none' }} />
        <button type="button" onClick={() => fileInputRef.current.click()} style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#f0f0f0', border: 'none', fontSize: '18px' }}>+</button>
        <form onSubmit={sendMessage} style={{ flex: 1, display: 'flex', background: '#f5f5f5', borderRadius: '20px', padding: '4px 8px' }}>
          <input type="text" value={input} onChange={handleInputChange} placeholder="메시지를 입력하세요" style={{ flex: 1, border: 'none', background: 'transparent', padding: '8px 12px', outline: 'none' }} />
          <button type="submit" disabled={!input.trim()} style={{ background: input.trim() ? '#fee500' : 'transparent', border: 'none', padding: '6px 14px', borderRadius: '16px', fontWeight: 'bold' }}>전송</button>
        </form>
      </div>

      {activeImg && (
        <div onClick={() => setActiveImg(null)} style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.9)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}><img src={activeImg} alt="확대뷰" style={{ maxWidth: '95%', maxHeight: '95%' }} /></div>
      )}
    </div>
  );
}

export default App;