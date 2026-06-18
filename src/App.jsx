import React, { useState, useEffect, useRef } from 'react';
import SockJS from 'sockjs-client';
import Stomp from 'stompjs';

function App() {
  // ─── 상태 관리 세트 ───
  const [status, setStatus] = useState('AUTH'); // AUTH(인증), IDLE(로비), MATCHING(매칭중), CHATTING(대화중), ADMIN(어드민)
  const [nickname, setNickname] = useState('');
  const [userKey, setUserKey] = useState('');
  
  const [roomId, setRoomId] = useState('');       
  const [messages, setMessages] = useState([]); 
  const [input, setInput] = useState('');       

  // 🤝 친구 기능용 상태 주머니
  const [opponentKey, setOpponentKey] = useState('');
  const [opponentNickname, setOpponentNickname] = useState('');
  const [friendList, setFriendList] = useState([]);      // 확정된 친구 목록
  const [pendingFriends, setPendingFriends] = useState([]); // 나한테 온 대기중인 신청 목록

  // 🛠️ 어드민 관제센터 상태 주머니
  const [adminReports, setAdminReports] = useState([]); // 전체 신고 접수 리스트
  const [isAdmin, setIsAdmin] = useState(false);       // 🔥 [추가] 운영자 권한 활성화 여부

  const [isOpponentTyping, setIsOpponentTyping] = useState(false); // 상대방 타이핑 상태
  const typingTimeoutRef = useRef(null); // 입력 멈춤 감지용 타이머
  
  // 📷 사진 확대를 위한 상태 주머니 (null이면 닫힘)
  const [activeImg, setActiveImg] = useState(null);

  const stompClientRef = useRef(null); 
  const fileInputRef = useRef(null); 

  // 1. 자동 로그인 분기 (기존 정보 확인)
  useEffect(() => {
    const savedKey = localStorage.getItem('rantalk_user_key');
    const savedNickname = localStorage.getItem('rantalk_nickname');
    if (savedKey && savedNickname) {
      setNickname(savedNickname);
      setUserKey(savedKey);
      
      // 💡 [자동 로그인 검사] 기존 닉네임이 [운영자]로 시작하면 권한 복구!
      if (savedNickname.startsWith('[운영자]')) {
        setIsAdmin(true);
      } else {
        setIsAdmin(false);
      }
      
      setStatus('IDLE'); 
    }
  }, []);

  // 📡 로비 대기실(IDLE) 상태일 때 친구 데이터를 주기적으로 새로고침
  useEffect(() => {
    if (status === 'IDLE' && userKey) {
      fetchFriendData();
    }
  }, [status, userKey]);

  // 📜 내 친구 목록 & 대기 목록 백엔드 호출 함수
  const fetchFriendData = async () => {
    if (!userKey) return;
    try {
      const pendingRes = await fetch(`http://localhost:8080/api/friends/pending/${userKey}`);
      if (pendingRes.ok) {
        const pendingData = await pendingRes.json();
        setPendingFriends(pendingData);
      }

      const listRes = await fetch(`http://localhost:8080/api/friends/list/${userKey}`);
      if (listRes.ok) {
        const listData = await listRes.json();
        setFriendList(listData);
      }
    } catch (error) {
      console.error("친구 데이터 로딩 실패:", error);
    }
  };

  // 🛠️ 어드민 화면 진입 시 전체 신고 내역 긁어오는 함수
  const fetchAdminReports = async () => {
    try {
      const res = await fetch('http://localhost:8080/api/reports/admin/list');
      if (res.ok) {
        const data = await res.json();
        setAdminReports(data);
      }
    } catch (error) {
      console.error("어드민 신고 내역 로드 실패:", error);
    }
  };

  // 🔓 [어드민] 특정 악성 유저 밴 해제(사면) 처리 함수
  const handleUnbanUser = async (targetKey) => {
    if (!window.confirm("정말 이 유저의 정지를 해제하시겠습니까?\n해당 유저의 모든 신고 이력이 초기화됩니다.")) return;
    
    try {
      const res = await fetch(`http://localhost:8080/api/reports/admin/unban/${targetKey}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        alert("정상적으로 정지가 해제되었습니다!");
        fetchAdminReports(); 
      }
    } catch (error) {
      console.error("정지 해제 실패:", error);
    }
  };

  // 2. 익명 회원 가입 / 인증 처리
  const handleAuth = async (e) => {
    e.preventDefault();
    if (!nickname.trim()) return;

    const existingKey = localStorage.getItem('rantalk_user_key');

    try {
      const response = await fetch('http://localhost:8080/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userKey: existingKey, nickname: nickname }),
      });

      const data = await response.json();

      localStorage.setItem('rantalk_user_key', data.userKey);
      localStorage.setItem('rantalk_nickname', data.nickname);

      setUserKey(data.userKey);
      setNickname(data.nickname);
      
      // 💡 [최초 로그인 검사] 입력한 닉네임이 [운영자]로 시작하면 어드민 마스터 권한 부여!
      if (data.nickname.startsWith('[운영자]')) {
        setIsAdmin(true);
      } else {
        setIsAdmin(false);
      }

      setStatus('IDLE'); 

    } catch (error) {
      console.error('인증 실패:', error);
      alert('서버와 통신이 원활하지 않습니다.');
    }
  };

  // 3. 🎲 랜덤 매칭 가동 및 웹소켓 바인딩 (차단 확인 로직 포함)
  const startMatch = async () => {
    try {
      const banCheckRes = await fetch(`http://localhost:8080/api/reports/check-ban/${userKey}`);
      if (banCheckRes.ok) {
        const banData = await banCheckRes.json();
        if (banData.isBanned) {
          alert(`🚫 이용이 제한된 계정입니다.\n\n사유: 타 유저로부터 누적 신고 접수됨.`);
          return; 
        }
      }
    } catch (error) {
      console.error("밴 상태 확인 실패:", error);
    }

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
        
        setRoomId(data.roomId);
        setOpponentKey(data.opponentKey); 
        setOpponentNickname(data.opponentNickname); 
        setStatus('CHATTING'); 

        try {
          const historyResponse = await fetch(`http://localhost:8080/api/chat/room/${data.roomId}/messages`);
          if (historyResponse.ok) {
            const historyMessages = await historyResponse.json();
            setMessages(historyMessages); 
          }
        } catch (err) {
          console.error("과거 대화 내역 로딩 실패:", err);
        }

        stompClient.subscribe(`/sub/chatroom/${data.roomId}`, (chatResponse) => {
          const receivedMessage = JSON.parse(chatResponse.body);
          setMessages((prev) => [...prev, receivedMessage]);
          setIsOpponentTyping(false); 
        });

        stompClient.subscribe(`/sub/chatroom/${data.roomId}/typing`, (typeResponse) => {
          const typeData = JSON.parse(typeResponse.body);
          if (typeData.sender !== nickname) {
            setIsOpponentTyping(typeData.isTyping);
          }
        });
      });

      stompClient.send('/pub/match/join', { nickname: nickname, userKey: userKey }, JSON.stringify({}));
    }, (error) => {
      console.error('웹소켓 연결 실패:', error);
      setStatus('IDLE');
    });
  };

  // ❌ 매칭 중단 및 로비 복귀 함수
  const handleCancelMatch = () => {
    if (stompClientRef.current) {
      stompClientRef.current.send('/pub/match/cancel', {}, JSON.stringify({}));
      stompClientRef.current.disconnect(() => {
        console.log("매칭 취소로 인한 웹소켓 종료");
      });
    }
    setStatus('IDLE');
  };

  // 💬 친구 전용 1:1 고정 대화방 순간이동 함수
  const handleStartFriendChat = async (friendshipId, friendName) => {
    try {
      const response = await fetch(`http://localhost:8080/api/friends/room/${friendshipId}`);
      if (!response.ok) throw new Error("방 정보 로딩 실패");
      const data = await response.json();
      const friendRoomId = data.roomId;

      setRoomId(friendRoomId);
      setOpponentNickname(friendName);
      setOpponentKey(''); 
      setMessages([]);

      const socket = new SockJS('http://localhost:8080/ws-chat');
      const stompClient = Stomp.over(socket);

      stompClient.connect({}, () => {
        stompClientRef.current = stompClient;
        setStatus('CHATTING'); 

        fetch(`http://localhost:8080/api/chat/room/${friendRoomId}/messages`)
          .then(res => res.json())
          .then(historyMessages => setMessages(historyMessages))
          .catch(err => console.error("과거 내역 로딩 실패:", err));

        stompClient.subscribe(`/sub/chatroom/${friendRoomId}`, (chatResponse) => {
          const receivedMessage = JSON.parse(chatResponse.body);
          setMessages((prev) => [...prev, receivedMessage]);
          setIsOpponentTyping(false);
        });

        stompClient.subscribe(`/sub/chatroom/${friendRoomId}/typing`, (typeResponse) => {
          const typeData = JSON.parse(typeResponse.body);
          if (typeData.sender !== nickname) {
            setIsOpponentTyping(typeData.isTyping);
          }
        });
      }, (error) => {
        console.error('친구 웹소켓 연결 실패:', error);
        alert("대화방에 입장할 수 없습니다.");
        setStatus('IDLE');
      });

    } catch (error) {
      console.error("친구 대화 시작 실패:", error);
    }
  };

  // 🤝 친구 신청 보내기 함수
  const handleRequestFriend = async () => {
    if (!opponentKey || opponentKey === 'unknown_key') {
      alert("이미 친구이거나 상대방의 고유 정보를 매칭 대화방에서만 불러올 수 있습니다.");
      return;
    }

    try {
      const response = await fetch('http://localhost:8080/api/friends/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requesterKey: userKey,
          receiverKey: opponentKey,
          requesterNickname: nickname,
          receiverNickname: opponentNickname
        })
      });

      if (response.ok) {
        alert(`${opponentNickname}님에게 친구 신청을 보냈습니다!`);
      } else {
        const errorMsg = await response.text();
        alert(errorMsg);
      }
    } catch (error) {
      console.error("친구 신청 실패:", error);
      alert("친구 신청 중 오류가 발생했습니다.");
    }
  };

  // 🚨 악성 유저 신고 함수
  const handleReportUser = async () => {
    if (!opponentKey || opponentKey === 'unknown_key') {
      alert("상대방의 고유 정보를 확인할 수 없어 신고할 수 없습니다. (친구 대화방은 신고 대상에서 제외됩니다)");
      return;
    }

    const reason = window.prompt("🚨 신고 사유를 입력해주세요. (예: 욕설, 비하, 음란성 채팅 등)\n허위 신고 시 본인이 제재를 받을 수 있습니다.");
    
    if (reason === null) return; 
    if (!reason.trim()) {
      alert("신고 사유를 반드시 입력해야 합니다.");
      return;
    }

    try {
      const response = await fetch('http://localhost:8080/api/reports/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reporterKey: userKey,
          targetKey: opponentKey,
          reason: reason
        })
      });

      if (response.ok) {
        alert("신고가 정상 접수되었습니다. 해당 유저와 방을 폭파하고 로비로 탈출합니다.");
        handleLeaveRoom(); 
      } else {
        const errorMsg = await response.text();
        alert(errorMsg);
      }
    } catch (error) {
      console.error("신고 접수 실패:", error);
      alert("신고 처리 중 서버 오류가 발생했습니다.");
    }
  };

  // ✅ 친구 신청 수락 / 거절 버튼 처리 함수
  const handleRespondFriend = async (friendshipId, action) => {
    try {
      const response = await fetch('http://localhost:8080/api/friends/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendshipId, action })
      });

      if (response.ok) {
        alert(action === 'ACCEPT' ? "친구 수락 완료!" : "친구 요청을 거절했습니다.");
        fetchFriendData(); 
      }
    } catch (error) {
      console.error("응답 처리 실패:", error);
    }
  };

  // ❌ 친구 삭제 요청 함수
  const handleDeleteFriend = async (friendshipId, friendName) => {
    if (!window.confirm(`${friendName}님을 친구 목록에서 삭제하시겠습니까?`)) {
      return; 
    }

    try {
      const response = await fetch(`http://localhost:8080/api/friends/delete/${friendshipId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        alert("친구 삭제가 완료되었습니다.");
        fetchFriendData(); 
      } else {
        alert("삭제 처리 중 오류가 발생했습니다.");
      }
    } catch (error) {
      console.error("친구 삭제 실패:", error);
    }
  };

  // 📝 텍스트 전송
  const sendMessage = (e) => {
    e.preventDefault();
    if (!input.trim() || !stompClientRef.current) return;

    const chatMessage = { roomId, sender: nickname, content: input, type: 'TEXT' };
    stompClientRef.current.send(`/pub/message/${roomId}`, {}, JSON.stringify(chatMessage));
    sendTypingSignal(false);
    setInput(''); 
  };

  // 📷 사진 업로드 처리
  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      alert("사진은 최대 10MB까지만 업로드할 수 있습니다.");
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('http://localhost:8080/api/chat/upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) throw new Error("서버 업로드 실패");
      const imageUrl = await response.text(); 

      if (stompClientRef.current) {
        const imageMessage = { roomId, sender: nickname, content: imageUrl, type: 'IMAGE' };
        stompClientRef.current.send(`/pub/message/${roomId}`, {}, JSON.stringify(imageMessage));
      }
    } catch (error) {
      console.error("이미지 전송 실패:", error);
      alert("이미지 전송 중 오류가 발생했습니다.");
    }
  };

  // ⌨️ 내 타이핑 신호 발송
  const sendTypingSignal = (isTyping) => {
    if (!stompClientRef.current || !roomId) return;
    stompClientRef.current.send(
      `/pub/message/${roomId}/typing`, 
      {}, 
      JSON.stringify({ sender: nickname, isTyping: isTyping })
    );
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
    sendTypingSignal(true);

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      sendTypingSignal(false);
    }, 1500); 
  };

  const handleLeaveRoom = () => {
    if (stompClientRef.current) {
      stompClientRef.current.send('/pub/match/leave', {}, {});
      stompClientRef.current.disconnect();
    }
    setRoomId('');
    setMessages([]);
    setOpponentKey('');
    setOpponentNickname('');
    setStatus('IDLE'); 
  };

  const handleRematch = () => {
    if (stompClientRef.current) {
      stompClientRef.current.send('/pub/match/leave', {}, {});
      stompClientRef.current.disconnect();
    }
    setRoomId('');
    setMessages([]);
    setOpponentKey('');
    setOpponentNickname('');
    startMatch(); 
  };


  // ─── 화면 렌더링 분기 처리 (레이아웃) ───

  if (status === 'AUTH') {
    return (
      <div style={{ padding: '50px', maxWidth: '400px', margin: '0 auto', textAlign: 'center' }}>
        <h2>📱 정통 랜덤채팅 란톡</h2>
        <p style={{ color: '#666' }}>닉네임만으로 바로 시작하세요.</p>
        <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <input type="text" placeholder="사용할 닉네임 (ex: [운영자]건우)" value={nickname} onChange={(e) => setNickname(e.target.value)} style={{ padding: '12px', fontSize: '16px' }} />
          <button type="submit" style={{ padding: '12px', background: '#4CAF50', color: 'white', border: 'none', fontSize: '16px', cursor: 'pointer' }}>란톡 입장하기</button>
        </form>
      </div>
    );
  }

  if (status === 'IDLE') {
    return (
      <div style={{ padding: '50px', maxWidth: '400px', margin: '0 auto', textAlign: 'center' }}>
        <h2>🚪 란톡 로비대기실</h2>
        <p>반갑습니다, <strong style={{ color: isAdmin ? 'red' : 'blue' }}>{nickname}</strong> {isAdmin ? '운영자' : ''}님</p>
        <button onClick={startMatch} style={{ width: '100%', padding: '15px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer', background: '#007BFF', color: 'white', border: 'none', borderRadius: '8px', marginBottom: '20px' }}>
          🎲 랜덤 상대와 매칭 시작
        </button>

        {/* 👥 친구 목록 시스템 대시보드 */}
        <div style={{ marginTop: '30px', padding: '20px', border: '1px solid #ddd', borderRadius: '8px', textAlign: 'left', background: '#fff' }}>
          
          {/* 🔔 1. 나한테 온 친구 신청 판넬 */}
          {pendingFriends.length > 0 && (
            <div style={{ marginBottom: '20px', padding: '12px', backgroundColor: '#fff3cd', borderRadius: '6px', border: '1px solid #ffeeba' }}>
              <h4 style={{ margin: '0 0 10px 0', color: '#856404' }}>🔔 새로운 친구 요청</h4>
              {pendingFriends.map((f) => (
                <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '14px' }}><b>{f.requesterNickname}</b> 님의 신호</span>
                  <div>
                    <button onClick={() => handleRespondFriend(f.id, 'ACCEPT')} style={{ marginRight: '4px', backgroundColor: '#28a745', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>수락</button>
                    <button onClick={() => handleRespondFriend(f.id, 'REJECT')} style={{ backgroundColor: '#dc3545', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>거절</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 👥 2. 내 확정 친구 리스트 */}
          <h3 style={{ marginTop: '0', borderBottom: '2px solid #007BFF', paddingBottom: '5px' }}>👥 내 친구 ({friendList.length}명)</h3>
          {friendList.length === 0 ? (
            <p style={{ color: '#888', fontSize: '13px', margin: '10px 0' }}>아직 친구가 없습니다. 매칭에서 친구를 사귀어보세요!</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: '0', margin: '0' }}>
              {friendList.map((f) => {
                const isMeRequester = f.requesterKey === userKey;
                const friendName = isMeRequester ? f.receiverNickname : f.requesterNickname;
                return (
                  <li key={f.id} style={{ padding: '10px 0', borderBottom: '1px solid #eee', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div 
                      onClick={() => handleStartFriendChat(f.id, friendName)}
                      style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', flex: 1 }}
                      title="클릭하면 대화방으로 입장합니다"
                    >
                      🟢 <b style={{ marginLeft: '5px', color: '#007BFF', textDecoration: 'underline' }}>{friendName}</b>
                      <span style={{ fontSize: '11px', color: '#888', marginLeft: '5px' }}>(대화하기)</span>
                    </div>
                    <button 
                      onClick={() => handleDeleteFriend(f.id, friendName)} 
                      style={{ 
                        backgroundColor: '#fff', color: '#dc3545', border: '1px solid #dc3545', 
                        padding: '2px 6px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold', transition: 'all 0.2s'
                      }}
                      onMouseOver={(e) => { e.currentTarget.style.backgroundColor = '#dc3545'; e.currentTarget.style.color = '#fff'; }}
                      onMouseOut={(e) => { e.currentTarget.style.backgroundColor = '#fff'; e.currentTarget.style.color = '#dc3545'; }}
                    >
                      삭제
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 🔥 [보안 수술완료] isAdmin 상태가 true(운영자)일 때만 비밀 통로가 나타남! 일반 유저는 안 보임 */}
        {isAdmin && (
          <button 
            onClick={() => {
              fetchAdminReports();
              setStatus('ADMIN');
            }} 
            style={{ marginTop: '30px', width: '100%', padding: '10px', background: '#343a40', color: 'white', border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            🛠️ 백오피스 운영자 시스템 진입
          </button>
        )}
      </div>
    );
  }

  if (status === 'MATCHING') {
    return (
      <div style={{ padding: '50px', maxWidth: '400px', margin: '0 auto', textAlign: 'center' }}>
        <h2>🔍 상대를 찾는 중입니다...</h2>
        <div style={{ margin: '30px auto', width: '50px', height: '50px', border: '5px solid #f3f3f3', borderTop: '5px solid #007BFF', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
        
        <button 
          onClick={handleCancelMatch} 
          style={{ 
            marginTop: '20px', padding: '10px 20px', fontSize: '15px', background: '#6c757d', color: 'white', 
            border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold'
          }}
        >
          ❌ 매칭 취소하고 뒤로가기
        </button>
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // status === 'ADMIN' (운영자 어드민 화면)
  if (status === 'ADMIN') {
    return (
      <div style={{ padding: '30px', maxWidth: '800px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px solid #343a40', paddingBottom: '10px', marginBottom: '20px' }}>
          <h2>🛠️ 란톡 관제센터 (어드민)</h2>
          <button onClick={() => setStatus('IDLE')} style={{ padding: '8px 16px', background: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
            ↩️ 로비로 돌아가기
          </button>
        </div>

        <h3>🚨 실시간 유저 신고 접수 현황</h3>
        {adminReports.length === 0 ? (
          <p style={{ color: '#888', textAlign: 'center', padding: '30px', border: '1px dashed #ccc' }}>현재 접수된 민원이 없습니다. 클린한 상태입니다.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px', fontSize: '14px' }}>
            <thead>
              <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
                <th style={{ padding: '12px', textAlign: 'left' }}>신고자 식별</th>
                <th style={{ padding: '12px', textAlign: 'left' }}>🚨 피신고자 (대상키)</th>
                <th style={{ padding: '12px', textAlign: 'left' }}>사유</th>
                <th style={{ padding: '12px', textAlign: 'left' }}>일시</th>
                <th style={{ padding: '12px', textAlign: 'center' }}>관리 조치</th>
              </tr>
            </thead>
            <tbody>
              {adminReports.map((report) => (
                <tr key={report.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '12px', color: '#666', fontFamily: 'monospace', fontSize: '12px' }}>{report.reporterKey.substring(0,8)}...</td>
                  <td style={{ padding: '12px', fontWeight: 'bold', color: '#dc3545', fontFamily: 'monospace', fontSize: '12px' }}>{report.targetKey}</td>
                  <td style={{ padding: '12px' }}>{report.reason}</td>
                  <td style={{ padding: '12px', fontSize: '12px', color: '#888' }}>
                    {new Date(report.createdAt).toLocaleString()}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    <button 
                      onClick={() => handleUnbanUser(report.targetKey)}
                      style={{ padding: '4px 8px', background: '#007BFF', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                    >
                      🔓 정지 해제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  // status === 'CHATTING'
  return (
    <div style={{ padding: '20px', maxWidth: '500px', margin: '0 auto' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: '#e9ecef', borderRadius: '6px', marginBottom: '15px' }}>
        <span style={{ fontSize: '15px' }}>🟢 <b>{opponentNickname}</b> 님</span>
        
        <div style={{ display: 'flex', gap: '8px' }}>
          {opponentKey && (
            <>
              <button onClick={handleRequestFriend} style={{ padding: '6px 12px', cursor: 'pointer', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', fontSize: '13px' }}>
                🤝 친구 신청
              </button>
              
              <button onClick={handleReportUser} style={{ padding: '6px 12px', cursor: 'pointer', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', fontSize: '13px' }}>
                🚨 신고/차단
              </button>
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
        <button onClick={handleLeaveRoom} style={{ padding: '10px 15px', background: '#dc3545', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}>🚪 나가기</button>
        {opponentKey && (
          <button onClick={handleRematch} style={{ padding: '10px 15px', background: '#ffc107', color: 'black', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}>🔄 재매칭</button>
        )}
      </div>
      
      <div style={{ border: '1px solid #ccc', height: '380px', overflowY: 'scroll', padding: '10px', marginBottom: '5px', background: '#f9f9f9', borderRadius: '4px' }}>
        {messages.map((msg, index) => (
          <div key={index} style={{ margin: '12px 0' }}>
            <strong style={{ color: msg.sender === '시스템' ? 'red' : 'black' }}>{msg.sender}:</strong>
            
            {msg.type === 'IMAGE' ? (
              <div style={{ marginTop: '5px' }}>
                <img 
                  src={msg.content} 
                  alt="전송 이미지" 
                  onClick={() => setActiveImg(msg.content)} 
                  style={{ maxWidth: '200px', maxHeight: '200px', borderRadius: '8px', border: '1px solid #ddd', cursor: 'pointer', transition: 'transform 0.2s' }} 
                  onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                  onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1.0)'}
                />
              </div>
            ) : (
              <span> {msg.content}</span>
            )}
          </div>
        ))}
      </div>

      <div style={{ height: '20px', marginBottom: '5px', paddingLeft: '5px' }}>
        {isOpponentTyping && (
          <span style={{ fontSize: '13px', color: '#28a745', fontStyle: 'italic', animation: 'blink 1s infinite' }}>
            💬 상대방이 메시지를 입력하고 있습니다...
          </span>
        )}
      </div>
      <style>{`@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }`}</style>

      <form onSubmit={sendMessage} style={{ display: 'flex', gap: '5px' }}>
        <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageUpload} style={{ display: 'none' }} />
        
        <button type="button" onClick={() => fileInputRef.current.click()} style={{ padding: '10px', background: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          📷
        </button>

        <input 
          type="text" 
          value={input} 
          onChange={handleInputChange} 
          placeholder="메시지를 입력하거나 사진을 첨부하세요..." 
          style={{ flex: 1, padding: '10px' }} 
        />
        <button type="submit" style={{ padding: '10px 20px', cursor: 'pointer', background: '#28a745', color: 'white', border: 'none', borderRadius: '4px' }}>전송</button>
      </form>

      {activeImg && (
        <div onClick={() => setActiveImg(null)} style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0, 0, 0, 0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999, cursor: 'zoom-out' }}>
          <button onClick={() => setActiveImg(null)} style={{ position: 'absolute', top: '20px', right: '20px', background: 'none', border: 'none', color: 'white', fontSize: '30px', cursor: 'pointer' }}>✕</button>
          <img src={activeImg} alt="확대 이미지" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain', boxShadow: '0 4px 20px rgba(0,0,0,0.5)', borderRadius: '4px', cursor: 'default' }} />
        </div>
      )}

    </div>
  );
}

export default App;