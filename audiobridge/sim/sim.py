#!/usr/bin/env python3
"""AudioBridge 가상 시뮬레이터 — 프로토콜 바이트·스테레오 채널·지터 버퍼·역할 협상.
동기 재생(시계 동기·재생 시각·지연)은 실제 앱 코드를 돌리는 sim/sync/run.sh 가 맡는다.
"""
import random, struct

FAIL = []
def check(name, cond, detail=""):
    tag = "OK  " if cond else "FAIL"
    if not cond: FAIL.append(name + (" — "+detail if detail else ""))
    print(f"[{tag}] {name}" + (f"  {detail}" if detail and not cond else ""))

SR = 48000
FRAME_MS = 5
HEADER = 24

# ---------- 1. 프로토콜 바이트 레이아웃 ----------
# Kotlin buildPacket (big-endian) 재현
def kt_build(payload, seq, channels, flags, ts_us, rate=SR):
    b = bytearray(HEADER + len(payload))
    b[0]=0x41; b[1]=0x42; b[2]=1; b[3]=0; b[4]=channels; b[5]=flags
    b[6]=(len(payload)>>8)&0xFF; b[7]=len(payload)&0xFF
    struct.pack_into(">I", b, 8, seq & 0xFFFFFFFF)
    struct.pack_into(">I", b, 12, rate)
    struct.pack_into(">Q", b, 16, ts_us & 0xFFFFFFFFFFFFFFFF)
    b[HEADER:] = payload
    return bytes(b)

# C# ParseHeader 재현 (동일 big-endian 해석)
def cs_parse(data):
    if len(data) < HEADER: return None
    if data[0]!=0x41 or data[1]!=0x42: return None
    if data[2]!=1 or data[3]!=0: return None
    ch = data[4]
    if ch<1 or ch>2: return None
    plen = (data[6]<<8)|data[7]
    if plen<=0 or plen>1400: return None
    seq = struct.unpack_from(">I", data, 8)[0]
    rate = struct.unpack_from(">I", data, 12)[0]
    if rate<8000 or rate>192000: return None
    ts = struct.unpack_from(">Q", data, 16)[0]
    return dict(ch=ch, flags=data[5], plen=plen, seq=seq, rate=rate, ts=ts)

def test_protocol():
    print("\n== 1. 프로토콜 바이트 왕복 (Kotlin build → C# parse) ==")
    for seq, ch, ts in [(0,2,0),(1,1,123456789),(0xFFFFFFFF,2,2**63-1),(70000,2,999)]:
        payload = bytes(range(0,240*2*ch % 256)) or b"\x01\x02"
        payload = bytes([(i*7)&0xFF for i in range(FRAME_MS*SR//1000*2*ch)])
        pkt = kt_build(payload, seq, ch, 1 if seq==0 else 0, ts)
        info = cs_parse(pkt)
        ok = info and info["seq"]==(seq&0xFFFFFFFF) and info["ch"]==ch and info["ts"]==(ts&0xFFFFFFFFFFFFFFFF) and info["plen"]==len(payload)
        check(f"round-trip seq={seq} ch={ch} ts={ts}", bool(ok), str(info))
    # 손상 패킷 거부
    bad = bytearray(kt_build(b"\x00"*480,5,1,0,10)); bad[0]=0x00
    check("magic 손상 패킷 거부", cs_parse(bytes(bad)) is None)
    check("길이 미달 패킷 거부", cs_parse(b"\x41\x42\x01") is None)

# ---------- 2. 스테레오 채널 추출 ----------
def extract_channel(frame_bytes, ch_idx):
    # Kotlin extractChannel 재현: 스테레오 16bit 인터리브에서 한 채널
    out = bytearray(len(frame_bytes)//2)
    src = ch_idx*2; dst=0
    while src+1 < len(frame_bytes):
        out[dst]=frame_bytes[src]; out[dst+1]=frame_bytes[src+1]
        dst+=2; src+=4
    return bytes(out)

def test_stereo():
    print("\n== 2. 스테레오 페어 채널 추출 ==")
    # L 샘플 = 1000, R 샘플 = -1000 인 스테레오 프레임
    n = 240
    frame = bytearray()
    for _ in range(n):
        frame += struct.pack("<h", 1000)   # L
        frame += struct.pack("<h", -1000)  # R
    L = extract_channel(frame, 0); R = extract_channel(frame, 1)
    lvals = struct.unpack(f"<{n}h", L); rvals = struct.unpack(f"<{n}h", R)
    check("왼쪽 채널만 추출", all(v==1000 for v in lvals), f"{set(lvals)}")
    check("오른쪽 채널만 추출", all(v==-1000 for v in rvals), f"{set(rvals)}")
    check("모노 길이 = 스테레오/2", len(L)==len(frame)//2)

# ---------- 3·4. 시계 동기·다기기 동기 재생 ----------
# 실제 앱 코드(ClockSync·PlayoutScheduler·CaptureTimeline·JitterBuffer)를 가상 기기·가상 Wi-Fi 위에서
# 그대로 돌리는 sim/sync/run.sh 로 옮겼다. 여기 있던 단순화 모델은 실제 코드와 달라 삭제.

# ---------- 5. 지터 버퍼 ----------
def test_jitter():
    print("\n== 5. 지터 버퍼 (손실/재정렬/랩어라운드) ==")
    class JB:
        def __init__(self): self.q=[]; self.exp=-1; self.recv=0; self.lost=0
        def push(self, seq, flags, payload):
            if flags & 1: self.exp=-1
            if self.exp>=0:
                diff = ((seq - self.exp) & 0xFFFFFFFF)
                if diff > 0x7FFFFFFF:  # 음수(과거)
                    return
                if diff>0:
                    self.lost+=diff
                    for _ in range(min(diff,40)): self.q.append(("SIL",))
            self.exp=(seq+1)&0xFFFFFFFF
            self.q.append(("DAT",seq)); self.recv+=1
    jb=JB()
    for seq in [0,1,2,4,5]:  # 3 손실
        jb.push(seq, 1 if seq==0 else 0, b"x")
    check("손실 1개 감지", jb.lost==1, f"lost={jb.lost}")
    sil = sum(1 for x in jb.q if x[0]=="SIL")
    check("무음 1프레임 삽입", sil==1, f"sil={sil}")
    jb2=JB()
    for seq in [0,1,3,2,4]:  # 2 도착 후 늦게 온 과거(2) 폐기
        jb2.push(seq, 1 if seq==0 else 0, b"x")
    dat=[x[1] for x in jb2.q if x[0]=="DAT"]
    check("과거 시퀀스(2) 폐기", 2 not in dat[3:], f"dat={dat}")
    # 랩어라운드: 2^32-1 → 0
    jb3=JB()
    jb3.push(0xFFFFFFFF,1,b"x")
    jb3.push(0,0,b"x")
    check("seq 랩어라운드 정상(무음 폭주 없음)", sum(1 for x in jb3.q if x[0]=="SIL")==0)

# ---------- 6. 역할 협상 상태기계 ----------
def test_roles():
    print("\n== 6. 역할 협상 (양쪽 선택 매칭) ==")
    def flows(my, peer_raw, peer_kind):
        # 내 프레임 정규화: peer가 'self'면 상대기기에서 소리 → 내겐 'peer'
        peer = {"self":"peer","other":"me"}.get(peer_raw)
        peer_wants = my if peer_kind=="pc" else peer
        listen = my=="me" and peer_wants=="me"
        send = my=="peer" and peer_wants=="peer"
        return listen, send
    # 폰↔폰: 나 me, 상대 other(→me) → 나 재생, 상대 송신
    l,s = flows("me","other","phone"); check("폰: 내가 듣기(상대 other)", l and not s)
    # 나 peer, 상대 self(→peer) → 나 송신
    l,s = flows("peer","self","phone"); check("폰: 내가 보내기(상대 self)", s and not l)
    # 둘 다 me → 충돌, 아무것도 안 함
    l,s = flows("me","other","phone"); # 상대도 me면 상대가 'other' 못보냄
    l2,s2 = flows("me","none","phone"); check("선택 불일치 시 정지", not l2 and not s2)
    # PC: 내가 me면 자동 재생
    l,s = flows("me","none","pc"); check("PC: 내가 me면 자동 듣기", l and not s)
    l,s = flows("peer","none","pc"); check("PC: 내가 peer면 자동 보내기", s and not l)

if __name__=="__main__":
    test_protocol()
    test_stereo()
    test_jitter()
    test_roles()
    print("\n"+"="*50)
    if FAIL:
        print(f"실패 {len(FAIL)}건:")
        for f in FAIL: print("  ✗", f)
        raise SystemExit(1)
    else:
        print("전체 통과 ✓")
