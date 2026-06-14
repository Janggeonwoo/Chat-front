import React, { useState, useEffect, useRef } from 'react';
import SockJS from 'sockjs-client';
import Stomp from 'stompjs';

function App() {
  const [status, setStatus] = useState('IDLE'); // IDLE(대기전), MATCHING(매칭중), CHATTING(채팅중)
  const [roomId, setRoomId] = useState('');       
  const [messages, setMessages] = useState([]); 
  const [input, setInput] = useState('');       
  const [name, setName] = useState('익명_' + Math.floor(Math.random() * 100)); 
  
  const stompClientRef = useRef(null); 

  // ⚡ [랜덤 매칭 시작] 단추 클릭 시
  const startMatch = () => {
    setStatus('MATCHING');

    const socket = new SockJS('http://localhost:8080/ws-chat');
    const stompClient = Stomp.over(socket);

    stompClient.connect({}, () => {
      stompClientRef.current = stompClient;

      // 🔥 핵심: 연결 직후 웹소켓 연결 주소 맨 끝에서 내 고유 세션 ID(식별자)를 추출합니다.
      const rawUrl = socket._transport.url;
      const urlParts = rawUrl.split('/');
      const mySessionId = urlParts[urlParts.length - 2]; 
      console.log("내 고유 세션 ID 확인:", mySessionId);

      // 🔥 변경: 백엔드가 내 세션 ID를 박아서 보낼 다이렉트 주소(/queue/match/내세션ID)를 구독합니다.
      stompClient.subscribe(`/queue/match/${mySessionId}`, (response) => {
        const data = JSON.parse(response.body);
        const matchedRoomId = data.roomId; 

        setRoomId(matchedRoomId);
        setStatus('CHATTING'); 

        stompClient.subscribe(`/sub/chatroom/${matchedRoomId}`, (chatResponse) => {
          const receivedMessage = JSON.parse(chatResponse.body);
          setMessages((prev) => [...prev, receivedMessage]);
        });
      });

      stompClient.send('/pub/match/join', {}, {});
    }, (error) => {
      console.error('웹소켓 연결 실패:', error);
      setStatus('IDLE');
    });
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (!input.trim() || !stompClientRef.current) return;

    const chatMessage = { roomId, sender: name, content: input };
    stompClientRef.current.send(`/pub/message/${roomId}`, {}, JSON.stringify(chatMessage));
    setInput(''); 
  };

  // 화면 1: 대기 전 메인 대기실
  if (status === 'IDLE') {
    return (
      <div style={{ padding: '50px', maxWidth: '400px', margin: '0 auto', textAlign: 'center' }}>
        <h2>📱 실시간 랜덤 매칭 앱</h2>
        <p>내 닉네임: <strong style={{ color: 'purple' }}>{name}</strong></p>
        <button onClick={startMatch} style={{ width: '100%', padding: '15px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer', background: '#007BFF', color: 'white', border: 'none', borderRadius: '8px' }}>
          🎲 랜덤 상대와 매칭 시작
        </button>
      </div>
    );
  }

  // 화면 2: 빙글빙글 매칭 대기 중
  if (status === 'MATCHING') {
    return (
      <div style={{ padding: '50px', maxWidth: '400px', margin: '0 auto', textAlign: 'center' }}>
        <h2>🔍 상대를 찾는 중입니다...</h2>
        <div className="spinner" style={{ margin: '30px auto', width: '50px', height: '50px', border: '5px solid #f3f3f3', borderTop: '5px solid #007BFF', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
        <p>잠시만 기다려 주세요. 대기열에서 짝을 맺고 있습니다.</p>
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // 화면 3: 대망의 매칭 성공! 1:1 비밀 채팅방
  return (
    <div style={{ padding: '20px', maxWidth: '500px', margin: '0 auto' }}>
      <h2 style={{ color: '#28a745' }}>🤝 매칭 성공! 1:1 대화중</h2>
      <h5 style={{ color: '#6c757d' }}>방 코드: {roomId}</h5>
      <h4>내 닉네임: <span style={{ color: 'blue' }}>{name}</span></h4>
      
      <div style={{ border: '1px solid #ccc', height: '300px', overflowY: 'scroll', padding: '10px', marginBottom: '10px', background: '#f9f9f9', borderRadius: '4px' }}>
        {messages.map((msg, index) => (
          <div key={index} style={{ margin: '5px 0' }}>
            <strong>{msg.sender}:</strong> {msg.content}
          </div>
        ))}
      </div>

      <form onSubmit={sendMessage} style={{ display: 'flex' }}>
        <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="매칭된 상대에게 톡을 보내세요..." style={{ flex: 1, padding: '10px' }} />
        <button type="submit" style={{ padding: '10px 20px', cursor: 'pointer', background: '#28a745', color: 'white', border: 'none' }}>전송</button>
      </form>
    </div>
  );
}

export default App;