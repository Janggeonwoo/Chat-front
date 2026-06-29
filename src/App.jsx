import React, { useState, useEffect, useRef } from 'react';
import SockJS from 'sockjs-client';
import Stomp from 'stompjs';

// 👑 카카오 앱 설정 값
const KAKAO_REST_API_KEY = "429780ef9d280c4afe7412483ee639ff";
const KAKAO_REDIRECT_URI = "http://localhost:8080/api/auth/kakao";
const KAKAO_AUTH_URL = `https://kauth.kakao.com/oauth/authorize?client_id=${KAKAO_REST_API_KEY}&redirect_uri=${KAKAO_REDIRECT_URI}&response_type=code`;

function App() {
  // ─── 상태 관리 세트 ───
  const [status, setStatus] = useState('AUTH'); 
  const [nickname, setNickname] = useState('');
  const [userKey, setUserKey] = useState('');
  
  // 💡 유저가 직접 선택/기입할 프로필 상태값
  const [gender, setGender] = useState('');
  const [age, setAge] = useState('');

  const [roomId, setRoomId] = useState('');      
  const [messages, setMessages] = useState([]); 
  const [input, setInput] = useState('');       

  // 🤝 친구 및 어드민 관제 상태
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

  // 1. ⚡ 최초 앱 구동 시 자동 로그인 검증 및 카카오 라우팅 분기 처리
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const backendStatus = params.get('status');
    const backendUserKey = params.get('userKey');
    const backendNickname = params.get('nickname');

    if (backendStatus === 'PROFILE_REQUIRED') {
      setUserKey(backendUserKey);
      setNickname(decodeURIComponent(backendNickname || '낯선 상대'));
      setStatus('PROFILE_SETTING'); 
      window.history.replaceState({}, null, window.location.pathname); 
      return; 
    } else if (backendStatus === 'LOGIN_SUCCESS') {
      localStorage.setItem('rantalk_user_key', backendUserKey);
      localStorage.setItem('rantalk_nickname', decodeURIComponent(backendNickname));
      setUserKey(backendUserKey);
      setNickname(decodeURIComponent(backendNickname));
      setIsAdmin(decodeURIComponent(backendNickname).startsWith('[운영자]'));
      setStatus('IDLE'); 
      window.history.replaceState({}, null, window.location.pathname);
      return;
    }

    const savedKey = localStorage.getItem('rantalk_user_key');
    const savedNickname = localStorage.getItem('rantalk_nickname');
    if (savedKey && savedNickname) {
      setNickname(savedNickname);
      setUserKey(savedKey);
      setIsAdmin(savedNickname.startsWith('[운영자]'));
      setStatus('IDLE'); 
    }
  }, []);

  // 로비 대기실 진입 시 친구 목록 동기화
  useEffect(() => {
    if (status === 'IDLE' && userKey) {
      fetchFriendData();
    }
  }, [status, userKey]);

  // 💡 [시간 버그 컷 고도화] 입력한 나이를 바탕으로 '출생 연도'를 계산해서 서버에 넘겨주는 함수
  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    if (!gender) return alert("성별을 선택해주세요.");
    if (!age || age < 14) return alert("올바른 나이를 입력해주세요. (14세 이상 가능)");

    const inputAge = parseInt(age);
    
    // 🔥 [핵심 추가] 현재 연도에서 입력한 나이를 빼서 불변하는 '출생 연도'를 구합니다.
    const currentYear = new Date().getFullYear(); 
    const birthYear = currentYear - inputAge + 1; // 예: 2026 - 27 + 1 = 2000년생

    // 매칭용 대역폭 계산 (27세 -> "20~29")
    const floorAge = Math.floor(inputAge / 10) * 10;
    const ageRange = `${floorAge}~${floorAge + 9}`;

    try {
      const res = await fetch('http://localhost:8080/api/auth/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          userKey, 
          gender, 
          age: birthYear, // 🎯 나이 숫자가 들어가던 자리에 변하지 않는 '출생 연도'를 슛!
          ageRange 
        })
      });
      
      if (res.ok) {
        localStorage.setItem('rantalk_user_key', userKey);
        localStorage.setItem('rantalk_nickname', nickname);
        alert("프로필 등록 완료! 대기실로 입장합니다.");
        setStatus('IDLE');
      } else {
        alert("프로필 저장 실패");
      }
    } catch (error) { 
      alert("서버 연동 에러"); 
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('rantalk_user_key');
    localStorage.removeItem('rantalk_nickname');
    setUserKey(''); setNickname(''); setStatus('AUTH');
  };

  // ─── [채팅/친구/신고 비즈니스 함수 세트] ───
  const fetchFriendData = async () => {
    if (!userKey) return;
    try {
      const pendingRes = await fetch(`http://localhost:8080/api/friends/pending/${userKey}`);
      if (pendingRes.ok) setPendingFriends(await pendingRes.json());
      const listRes = await fetch(`http://localhost:8080/api/friends/list/${userKey}`);
      if (listRes.ok) setFriendList(await listRes.json());
    } catch (e) {}
  };

  const fetchAdminReports = async () => {
    try {
      const res = await fetch('http://localhost:8080/api/reports/admin/list');
      if (res.ok) setAdminReports(await res.json());
    } catch (e) {}
  };

  const handleUnbanUser = async (targetKey) => {
    if (!window.confirm("정말 이 유저의 정지를 해제하시겠습니까?")) return;
    try {
      const res = await fetch(`http://localhost:8080/api/reports/admin/unban/${targetKey}`, { method: 'DELETE' });
      if (res.ok) { alert("정지가 해제되었습니다!"); fetchAdminReports(); }
    } catch (e) {}
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
    } catch (e) {}

    setStatus('MATCHING');
    const socket = new SockJS('http://localhost:8080/ws-chat');
    const stompClient = Stomp.over(socket);

    stompClient.connect({}, () => {
      stompClientRef.current = stompClient;
      const mySessionId = socket._transport.url.split('/').slice(-2, -1)[0];

      stompClient.subscribe(`/queue/match/${mySessionId}`, async (res) => {
        const data = JSON.parse(res.body);
        setRoomId(data.roomId); setOpponentKey(data.opponentKey); setOpponentNickname(data.opponentNickname);
        setStatus('CHATTING');
        const hist = await fetch(`http://localhost:8080/api/chat/room/${data.roomId}/messages`);
        if (hist.ok) setMessages(await hist.json());
        
        stompClient.subscribe(`/sub/chatroom/${data.roomId}`, (chat) => {
          setMessages(prev => [...prev, JSON.parse(chat.body)]);
          setIsOpponentTyping(false);
        });

        stompClient.subscribe(`/sub/chatroom/${data.roomId}/typing`, (typeResponse) => {
          const typeData = JSON.parse(typeResponse.body);
          if (typeData.sender !== nickname) setIsOpponentTyping(typeData.isTyping);
        });
      });
      stompClient.send('/pub/match/join', { nickname, userKey }, JSON.stringify({}));
    });
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
      const data = await (await fetch(`http://localhost:8080/api/friends/room/${friendshipId}`)).json();
      setRoomId(data.roomId); setOpponentNickname(friendName); setOpponentKey(''); setMessages([]);
      const socket = new SockJS('http://localhost:8080/ws-chat');
      const stompClient = Stomp.over(socket);
      stompClient.connect({}, () => {
        stompClientRef.current = stompClient; setStatus('CHATTING');
        fetch(`http://localhost:8080/api/chat/room/${data.roomId}/messages`).then(res => res.json()).then(m => setMessages(m));
        stompClient.subscribe(`/sub/chatroom/${data.roomId}`, (res) => setMessages(prev => [...prev, JSON.parse(res.body)]));
      });
    } catch (e) {}
  };

  const handleRequestFriend = async () => {
    if (!opponentKey) return alert("대화방에서만 신청 가능합니다.");
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
        body: JSON.stringify({ reporterKey: userKey, targetKey: opponentKey, reason })
      });
      if (response.ok) { alert("신고 완료. 즉시 재매칭합니다."); handleRematch(); }
    } catch (e) {}
  };

  const handleRespondFriend = async (friendshipId, action) => {
    try {
      if ((await fetch('http://localhost:8080/api/friends/respond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ friendshipId, action }) })).ok) fetchFriendData();
    } catch (e) {}
  };

  const handleDeleteFriend = async (friendshipId, friendName) => {
    if (!window.confirm(`${friendName}님과 절교하시겠습니까?`)) return;
    try {
      if ((await fetch(`http://localhost:8080/api/friends/delete/${friendshipId}`, { method: 'DELETE' })).ok) fetchFriendData();
    } catch (e) {}
  };

  const sendMessage = (e) => {
    e.preventDefault(); if (!input.trim()) return;
    stompClientRef.current.send(`/pub/message/${roomId}`, {}, JSON.stringify({ roomId, sender: nickname, content: input, type: 'TEXT' }));
    setInput('');
  };

  const handleImageUpload = async (e) => {
    const formData = new FormData(); formData.append('file', e.target.files[0]);
    const url = await (await fetch('http://localhost:8080/api/chat/upload', { method: 'POST', body: formData })).text();
    stompClientRef.current.send(`/pub/message/${roomId}`, {}, JSON.stringify({ roomId, sender: nickname, content: url, type: 'IMAGE' }));
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

  // ─── 📱 모바일 UI 스타일 ───
  const containerStyle = { width: '100vw', height: '100vh', maxWidth: '480px', margin: '0 auto', background: '#f4f6fa', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' };
  const cardStyle = { background: '#fff', padding: '35px 25px', borderRadius: '18px', boxShadow: '0 8px 24px rgba(0,0,0,0.04)', width: '90%', maxWidth: '380px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center' };
  const btnPrimary = { width: '100%', padding: '15px', background: '#4F46E5', color: 'white', border: 'none', borderRadius: '10px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' };
  const inputStyle = { padding: '14px', fontSize: '15px', border: '1px solid #e5e7eb', borderRadius: '8px', width: '100%', boxSizing: 'border-box', background: '#f9fafb' };

  // ─── [화면 뷰 분기 핸들러] ───

  // [화면 1] AUTH: 카카오 대문
  if (status === 'AUTH') {
    return (
      <div style={containerStyle}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={cardStyle}>
            <div style={{ fontSize: '60px', marginBottom: '15px' }}>📱</div>
            <h2 style={{ fontSize: '24px', fontWeight: '800', textAlign: 'center', margin: '0 0 8px 0' }}>란톡 시작하기</h2>
            <p style={{ color: '#6b7280', fontSize: '14px', textAlign: 'center', marginBottom: '40px', lineHeight: '1.4' }}>카카오 1초 간편 인증을 통해<br />안전하고 클린한 랜덤 채팅을 즐겨보세요!</p>
            <a href={KAKAO_AUTH_URL} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '16px 0', background: '#FEE500', color: '#191919', borderRadius: '12px', fontSize: '16px', fontWeight: 'bold', textDecoration: 'none', boxShadow: '0 4px 12px rgba(254,229,0,0.25)' }}>
              💛 카카오톡으로 1초 로그인
            </a>
          </div>
        </div>
      </div>
    );
  }

  // [화면 2] PROFILE_SETTING: 신규 가입 유저 성별/나이 수동 기입 팝업 모달 스킨
  if (status === 'PROFILE_SETTING') {
    return (
      <div style={containerStyle}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={cardStyle}>
            <h3 style={{ fontSize: '20px', fontWeight: 'bold', margin: '0 0 10px 0' }}>성별 및 나이 선택</h3>
            <p style={{ color: '#6b7280', fontSize: '13px', textAlign: 'center', marginBottom: '30px' }}>정확한 조건 매칭 활용을 위해 프로필을 등록해 주세요.</p>
            <form onSubmit={handleProfileSubmit} style={{ width: '100%' }}>
              <label style={{ fontSize: '12px', color: '#6b7280', fontWeight: 'bold' }}>성별</label>
              <div style={{ display: 'flex', gap: '10px', margin: '8px 0 20px 0' }}>
                <button type="button" onClick={() => setGender('MALE')} style={{ flex: 1, padding: '12px', borderRadius: '8px', border: gender === 'MALE' ? '2px solid #4F46E5' : '1px solid #d1d5db', background: gender === 'MALE' ? '#EEF2FF' : '#fff', color: gender === 'MALE' ? '#4F46E5' : '#111', fontWeight: 'bold', cursor: 'pointer' }}>남자 🧑</button>
                <button type="button" onClick={() => setGender('FEMALE')} style={{ flex: 1, padding: '12px', borderRadius: '8px', border: gender === 'FEMALE' ? '2px solid #EC4899' : '1px solid #d1d5db', background: gender === 'FEMALE' ? '#FDF2F8' : '#fff', color: gender === 'FEMALE' ? '#EC4899' : '#111', fontWeight: 'bold', cursor: 'pointer' }}>여자 👩</button>
              </div>
              <label style={{ fontSize: '12px', color: '#6b7280', fontWeight: 'bold' }}>나이</label>
              <input type="number" placeholder="본인 나이 입력 (예: 25)" value={age} onChange={e => setAge(e.target.value)} style={{ ...inputStyle, marginTop: '8px', marginBottom: '30px' }} required />
              <button type="submit" style={btnPrimary}>설정 완료 및 대기실 입장</button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // [화면 3] IDLE: 로비 대기실
  if (status === 'IDLE') {
    return (
      <div style={containerStyle}>
        <div style={{ background: '#fff', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e5e7eb' }}>
          <span style={{ fontSize: '15px', fontWeight: 'bold' }}>👋 <b style={{ color: isAdmin ? '#ef4444' : '#4F46E5' }}>{nickname}</b>님</span>
          <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' }}>로그아웃</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', paddingBottom: '80px' }}>
          {currentTab === 'MATCH' ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '80%' }}>
              <div style={{ textAlign: 'center', marginBottom: '35px' }}>
                <div style={{ fontSize: '64px', marginBottom: '10px' }}>🎲</div>
                <h3 style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 6px 0' }}>랜덤 매칭</h3>
                <p style={{ color: '#6b7280', fontSize: '14px', margin: 0 }}>실시간 접속자 중 상대를 매칭합니다.</p>
              </div>
              <button onClick={startMatch} style={{ ...btnPrimary, fontSize: '17px', padding: '16px' }}>🎲 랜덤 매칭 시작하기</button>
              {isAdmin && <button onClick={() => { fetchAdminReports(); setStatus('ADMIN'); }} style={{ marginTop: '20px', width: '100%', padding: '12px', background: '#1f2937', color: 'white', border: 'none', borderRadius: '10px', fontSize: '13px', cursor: 'pointer' }}>🛠️ 관제 레이더 진입</button>}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              {pendingFriends.length > 0 && (
                <div style={{ background: '#fffbeb', padding: '14px', borderRadius: '12px', border: '1px solid #fef3c7' }}>
                  <h5 style={{ margin: '0 0 10px 0', color: '#b45309', fontSize: '13px' }}>🔔 도착한 친구 요청</h5>
                  {pendingFriends.map(f => (
                    <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '14px' }}>
                      <span><b>{f.requesterNickname}</b>님</span>
                      <div>
                        <button onClick={() => handleRespondFriend(f.id, 'ACCEPT')} style={{ background: '#10B981', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: '6px', marginRight: '6px', fontSize: '12px', fontWeight: 'bold' }}>수락</button>
                        <button onClick={() => handleRespondFriend(f.id, 'REJECT')} style={{ background: '#6b7280', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: '6px', fontSize: '12px' }}>거절</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <h4 style={{ margin: '0', fontSize: '15px', fontWeight: '700' }}>👥 내 인맥 목록 ({friendList.length}명)</h4>
              {friendList.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#9ca3af', minHeight: '220px' }}>
                  <span style={{ fontSize: '40px' }}>👤</span><p style={{ fontSize: '14px', margin: 0 }}>등록된 친구가 없습니다.</p>
                </div>
              ) : (
                friendList.map(f => {
                  const friendName = f.requesterKey === userKey ? f.receiverNickname : f.requesterNickname;
                  return (
                    <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px', background: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb' }}>
                      <div onClick={() => handleStartFriendChat(f.id, friendName)} style={{ cursor: 'pointer', flex: 1, fontSize: '15px', fontWeight: '500' }}>🟢 {friendName} <span style={{ fontSize: '12px', color: '#4F46E5', marginLeft: '6px' }}>[톡]</span></div>
                      <button onClick={() => handleDeleteFriend(f.id, friendName)} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '13px', cursor: 'pointer' }}>삭제</button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', borderTop: '1px solid #e5e7eb', background: '#fff', position: 'absolute', bottom: '0', left: '0', width: '100%', zIndex: 100 }}>
          <button onClick={() => setCurrentTab('MATCH')} style={{ flex: 1, padding: '14px 0', border: 'none', background: 'transparent', color: currentTab === 'MATCH' ? '#4F46E5' : '#9ca3af', fontWeight: 'bold' }}>💬<br/>매칭/홈</button>
          <button onClick={() => setCurrentTab('FRIEND')} style={{ flex: 1, padding: '14px 0', border: 'none', background: 'transparent', color: currentTab === 'FRIEND' ? '#4F46E5' : '#9ca3af', fontWeight: 'bold' }}>👥<br/>친구 목록</button>
        </div>
      </div>
    );
  }

  // [화면 4] MATCHING
  if (status === 'MATCHING') {
    return (
      <div style={containerStyle}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ ...cardStyle, textAlign: 'center' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '18px' }}>🔍 상대를 찾고 있습니다</h3>
            <div style={{ margin: '30px auto', width: '40px', height: '40px', border: '4px solid #f3f4f6', borderTop: '4px solid #4F46E5', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
            <button onClick={handleCancelMatch} style={{ ...btnPrimary, background: '#6b7280', padding: '12px', fontSize: '14px' }}>매칭 취소</button>
            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
          </div>
        </div>
      </div>
    );
  }

  // [화면 5] ADMIN
  if (status === 'ADMIN') {
    return (
      <div style={{ ...containerStyle, maxWidth: '100vw', background: '#fff' }}>
        <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #f3f4f6' }}>
          <h2 style={{ margin: 0, fontSize: '18px' }}>🛠️ 관제 센터</h2>
          <button onClick={() => setStatus('IDLE')} style={{ padding: '6px 14px', background: '#6b7280', color: '#fff', border: 'none', borderRadius: '6px' }}>로비 복귀</button>
        </div>
        <div style={{ flex: 1, padding: '10px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead><tr style={{ background: '#f9fafb' }}><th style={{ padding: '10px', textAlign: 'left' }}>대상</th><th style={{ padding: '10px', textAlign: 'left' }}>사유</th><th style={{ padding: '10px', textAlign: 'center' }}>조치</th></tr></thead>
            <tbody>
              {adminReports.map(r => (
                <tr style={{ borderBottom: '1px solid #f3f4f6' }} key={r.id}>
                  <td style={{ padding: '10px', color: '#ef4444', fontWeight: 'bold' }}>{r.targetKey.substring(0,6)}..</td>
                  <td style={{ padding: '10px' }}>{r.reason}</td>
                  <td style={{ padding: '10px', textAlign: 'center' }}><button onClick={() => handleUnbanUser(r.targetKey)} style={{ background: '#4F46E5', color: 'white', border: 'none', padding: '4px 8px', borderRadius: '4px' }}>🔓 해제</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // [화면 6] CHATTING
  return (
    <div style={containerStyle}>
      <div style={{ background: '#fff', padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e5e7eb', zIndex: 10 }}>
        <b>🟢 {opponentNickname}</b>
        <div style={{ display: 'flex', gap: '6px' }}>
          {opponentKey && (
            <>
              <button onClick={handleRematch} style={{ padding: '6px 10px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold' }}>⚡ 다음</button>
              <button onClick={handleRequestFriend} style={{ padding: '6px 10px', background: '#10B981', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold' }}>🤝 친구</button>
              <button onClick={handleReportUser} style={{ padding: '6px 10px', background: '#fff', color: '#ef4444', border: '1px solid #ef4444', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold' }}>🚨 신고</button>
            </>
          )}
          <button onClick={handleLeaveRoom} style={{ padding: '6px 10px', background: '#9ca3af', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold' }}>나가기</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', background: '#abc1d1' }}>
        {messages.map((msg, index) => {
          const isMe = msg.sender === nickname;
          if (msg.sender === '시스템') return (<div key={index} style={{ textAlign: 'center' }}><span style={{ background: 'rgba(0,0,0,0.12)', color: '#fff', padding: '4px 12px', borderRadius: '12px', fontSize: '12px' }}>{msg.content}</span></div>);

          return (
            <div key={index} style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
              {!isMe && <span style={{ fontSize: '12px', color: '#4b5563', marginBottom: '4px' }}>{msg.sender}</span>}
              <div style={{ background: isMe ? '#fee500' : '#fff', color: '#111', borderRadius: '12px', boxShadow: '0 1px 2px rgba(0,0,0,0.08)', maxWidth: '75%', overflow: 'hidden' }}>
                {msg.type === 'IMAGE' ? (
                  <div onClick={() => setActiveImg(msg.content)} style={{ position: 'relative', width: '120px', height: '120px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#eee' }}>
                    <img src={msg.content} alt="썸네일" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(6px) brightness(0.9)' }} />
                    <div style={{ position: 'absolute', color: 'white', fontSize: '11px', fontWeight: 'bold', background: 'rgba(0,0,0,0.4)', padding: '3px 8px', borderRadius: '10px' }}>보기 🔍</div>
                  </div>
                ) : (
                  <div style={{ padding: '10px 14px', fontSize: '14px', wordBreak: 'break-all' }}>{msg.content}</div>
                )}
              </div>
            </div>
          );
        })}
        {isOpponentTyping && <div style={{ alignSelf: 'flex-start', background: 'rgba(255,255,255,0.6)', padding: '6px 12px', borderRadius: '10px', fontSize: '12px' }}>💬 상대방이 치는 중...</div>}
        <div ref={messageEndRef} />
      </div>

      <div style={{ background: '#fff', padding: '10px 12px', display: 'flex', gap: '8px', alignItems: 'center', borderTop: '1px solid #e5e7eb', paddingBottom: 'calc(10px + env(safe-area-inset-bottom))' }}>
        <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageUpload} style={{ display: 'none' }} />
        <button type="button" onClick={() => fileInputRef.current.click()} style={{ width: '38px', height: '38px', borderRadius: '50%', background: '#f3f4f6', border: 'none', fontSize: '20px', cursor: 'pointer' }}>+</button>
        <form onSubmit={sendMessage} style={{ flex: 1, display: 'flex', background: '#f3f4f6', borderRadius: '20px', padding: '2px 6px', alignItems: 'center' }}>
          <input type="text" value={input} onChange={handleInputChange} placeholder="메시지를 입력하세요" style={{ flex: 1, border: 'none', background: 'transparent', padding: '10px 12px', outline: 'none', fontSize: '14px' }} />
          <button type="submit" disabled={!input.trim()} style={{ background: input.trim() ? '#fee500' : 'transparent', border: 'none', padding: '6px 14px', borderRadius: '16px', fontWeight: 'bold', cursor: 'pointer' }}>전송</button>
        </form>
      </div>

      {activeImg && (
        <div onClick={() => setActiveImg(null)} style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.95)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}><img src={activeImg} alt="원래사이즈" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /></div>
      )}
    </div>
  );
}

export default App;