import React, { useState, useEffect, useRef } from 'react';
import SockJS from 'sockjs-client';
import Stomp from 'stompjs';

function App() {
  // ─── 상태 관리 세트 ───
  const [status, setStatus] = useState('AUTH'); // AUTH(인증), IDLE(로비), MATCHING(매칭중), CHATTING(대화중)
  const [nickname, setNickname] = useState('');
  const [userKey, setUserKey] = useState('');
  
  const [roomId, setRoomId] = useState('');       
  const [messages, setMessages] = useState([]); 
  const [input, setInput] = useState('');       
  
  // 📷 카톡 스타일 사진 확대를 위한 상태 주머니 (null이면 닫힘, 이미지URL이 들어오면 열림)
  const [activeImg, setActiveImg] = useState(null);

  const stompClientRef = useRef(null); 
  const fileInputRef = useRef(null); 

  // 1. 자동 로그인 분기 (기존 기기 정보 있으면 로비로 자동 기동)
  useEffect(() => {
    const savedKey = localStorage.getItem('rantalk_user_key');
    const savedNickname = localStorage.getItem('rantalk_nickname');
    if (savedKey && savedNickname) {
      setNickname(savedNickname);
      setUserKey(savedKey);
      setStatus('IDLE'); 
    }
  }, []);

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
      setStatus('IDLE'); 

    } catch (error) {
      console.error('인증 실패:', error);
      alert('서버와 통신이 원활하지 않습니다.');
    }
  };

  // 3. 🎲 랜덤 매칭 가동 및 웹소켓 바인딩
  const startMatch = () => {
    setStatus('MATCHING');

    const socket = new SockJS('http://localhost:8080/ws-chat');
    const stompClient = Stomp.over(socket);

    stompClient.connect({}, () => {
      stompClientRef.current = stompClient;

      const rawUrl = socket._transport.url;
      const urlParts = rawUrl.split('/');
      const mySessionId = urlParts[urlParts.length - 2]; 

      // 귓속말 매칭 큐 구독
      stompClient.subscribe(`/queue/match/${mySessionId}`, async (response) => {
        const data = JSON.parse(response.body);
        const matchedRoomId = data.roomId; 

        setRoomId(matchedRoomId);
        setStatus('CHATTING'); 

        // ⏳ 방 입장 즉시 백엔드 DB에서 과거 기록 로딩
        try {
          const historyResponse = await fetch(`http://localhost:8080/api/chat/room/${matchedRoomId}/messages`);
          if (historyResponse.ok) {
            const historyMessages = await historyResponse.json();
            setMessages(historyMessages); 
          }
        } catch (err) {
          console.error("과거 대화 내역 로딩 실패:", err);
        }

        // 실시간 대화방 메인 채널 구독
        stompClient.subscribe(`/sub/chatroom/${matchedRoomId}`, (chatResponse) => {
          const receivedMessage = JSON.parse(chatResponse.body);
          setMessages((prev) => [...prev, receivedMessage]);
        });
      });

      // 백엔드에 매칭 노크 (두 번째 인자 헤더에 닉네임 장착)
      stompClient.send('/pub/match/join', { nickname: nickname }, JSON.stringify({}));
    }, (error) => {
      console.error('웹소켓 연결 실패:', error);
      setStatus('IDLE');
    });
  };

  // 📝 텍스트 전송
  const sendMessage = (e) => {
    e.preventDefault();
    if (!input.trim() || !stompClientRef.current) return;

    const chatMessage = { roomId, sender: nickname, content: input, type: 'TEXT' };
    stompClientRef.current.send(`/pub/message/${roomId}`, {}, JSON.stringify(chatMessage));
    setInput(''); 
  };

  // 📷 이미지 파일 백엔드 서버 업로드 후 웹소켓 발송
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
        const imageMessage = {
          roomId: roomId,
          sender: nickname,
          content: imageUrl, 
          type: 'IMAGE'
        };
        stompClientRef.current.send(`/pub/message/${roomId}`, {}, JSON.stringify(imageMessage));
      }

    } catch (error) {
      console.error("이미지 전송 실패:", error);
      alert("이미지 전송 중 오류가 발생했습니다.");
    }
  };

  // 🚪 수동 방 나가기 핸들러
  const handleLeaveRoom = () => {
    if (stompClientRef.current) {
      stompClientRef.current.send('/pub/match/leave', {}, {});
      stompClientRef.current.disconnect(() => {
        console.log("웹소켓 연결 종료");
      });
    }
    setRoomId('');
    setMessages([]);
    setStatus('IDLE'); 
  };

  // 🔄 즉시 재매칭 핸들러
  const handleRematch = () => {
    if (stompClientRef.current) {
      stompClientRef.current.send('/pub/match/leave', {}, {});
      stompClientRef.current.disconnect();
    }
    setRoomId('');
    setMessages([]);
    startMatch(); 
  };


  // ─── 화면 렌더링 분기 처리 (레이아웃) ───

  // 화면 1: 최초 진입 (닉네임 입력 단계)
  if (status === 'AUTH') {
    return (
      <div style={{ padding: '50px', maxWidth: '400px', margin: '0 auto', textAlign: 'center' }}>
        <h2>📱 정통 랜덤채팅 란톡</h2>
        <p style={{ color: '#666' }}>닉네임만으로 바로 시작하세요.</p>
        <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <input type="text" placeholder="사용할 닉네임" value={nickname} onChange={(e) => setNickname(e.target.value)} style={{ padding: '12px', fontSize: '16px' }} />
          <button type="submit" style={{ padding: '12px', background: '#4CAF50', color: 'white', border: 'none', fontSize: '16px', cursor: 'pointer' }}>란톡 입장하기</button>
        </form>
      </div>
    );
  }

  // 화면 2: 로비 대기실 메인
  if (status === 'IDLE') {
    return (
      <div style={{ padding: '50px', maxWidth: '400px', margin: '0 auto', textAlign: 'center' }}>
        <h2>🚪 란톡 로비대기실</h2>
        <p>반갑습니다, <strong style={{ color: 'blue' }}>{nickname}</strong> 님</p>
        <button onClick={startMatch} style={{ width: '100%', padding: '15px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer', background: '#007BFF', color: 'white', border: 'none', borderRadius: '8px' }}>
          🎲 랜덤 상대와 매칭 시작
        </button>
      </div>
    );
  }

  // 화면 3: 매칭 대기 로딩 중
  if (status === 'MATCHING') {
    return (
      <div style={{ padding: '50px', maxWidth: '400px', margin: '0 auto', textAlign: 'center' }}>
        <h2>🔍 상대를 찾는 중입니다...</h2>
        <div style={{ margin: '30px auto', width: '50px', height: '50px', border: '5px solid #f3f3f3', borderTop: '5px solid #007BFF', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // 화면 4: 대망의 매칭 성공 채팅방
  return (
    <div style={{ padding: '20px', maxWidth: '500px', margin: '0 auto' }}>
      {/* 상단 컨트롤 버튼 바 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
        <button onClick={handleLeaveRoom} style={{ padding: '10px 15px', background: '#dc3545', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}>🚪 나가기</button>
        <button onClick={handleRematch} style={{ padding: '10px 15px', background: '#ffc107', color: 'black', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}>🔄 재매칭</button>
      </div>

      <h2 style={{ color: '#28a745' }}>🤝 란톡 1:1 대화방</h2>
      
      {/* 실시간 메시지 스크롤 창 */}
      <div style={{ border: '1px solid #ccc', height: '400px', overflowY: 'scroll', padding: '10px', marginBottom: '10px', background: '#f9f9f9', borderRadius: '4px' }}>
        {messages.map((msg, index) => (
          <div key={index} style={{ margin: '12px 0' }}>
            <strong style={{ color: msg.sender === '시스템' ? 'red' : 'black' }}>{msg.sender}:</strong>
            
            {/* 데이터 종류(type)에 따른 말풍선 조건부 렌더링 */}
            {msg.type === 'IMAGE' ? (
              <div style={{ marginTop: '5px' }}>
                <img 
                  src={msg.content} 
                  alt="전송 이미지" 
                  onClick={() => setActiveImg(msg.content)} // 👈 사진 클릭 시 오버레이 상태 활성화
                  style={{ 
                    maxWidth: '200px', 
                    maxHeight: '200px', 
                    borderRadius: '8px', 
                    border: '1px solid #ddd',
                    cursor: 'pointer',
                    transition: 'transform 0.2s'
                  }} 
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

      {/* 하단 전송 및 미디어 패널 폼 */}
      <form onSubmit={sendMessage} style={{ display: 'flex', gap: '5px' }}>
        <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageUpload} style={{ display: 'none' }} />
        
        <button type="button" onClick={() => fileInputRef.current.click()} style={{ padding: '10px', background: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          📷
        </button>

        <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="메시지를 입력하거나 사진을 첨부하세요..." style={{ flex: 1, padding: '10px' }} />
        <button type="submit" style={{ padding: '10px 20px', cursor: 'pointer', background: '#28a745', color: 'white', border: 'none', borderRadius: '4px' }}>전송</button>
      </form>

      {/* 🛑 카카오톡 스타일 이미지 풀 스크린 확대 모달 */}
      {activeImg && (
        <div 
          onClick={() => setActiveImg(null)} 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 9999,
            cursor: 'zoom-out'
          }}
        >
          <button 
            onClick={() => setActiveImg(null)}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              background: 'none',
              border: 'none',
              color: 'white',
              fontSize: '30px',
              cursor: 'pointer'
            }}
          >
            ✕
          </button>
          <img 
            src={activeImg} 
            alt="확대 이미지" 
            onClick={(e) => e.stopPropagation()} 
            style={{ 
              maxWidth: '90%', 
              maxHeight: '90%', 
              objectFit: 'contain', 
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              borderRadius: '4px',
              cursor: 'default'
            }} 
          />
        </div>
      )}

    </div>
  );
}

export default App;