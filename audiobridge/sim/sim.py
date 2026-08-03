#!/usr/bin/env python3
"""AudioBridge 가상 시뮬레이터.
실제 Kotlin/C# 로직을 바이트/산술 단위로 재현해 다기기 동기·프로토콜·지터를 검증한다.
목표: 실사용에서 나온 '기기 간 레이턴시 차이' 버그를 재현/확인한다.
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

# ---------- 3. 시계 동기 (ClockSync min-RTT) ----------
class ClockSync:
    def __init__(self): self.offset=None; self.best=float('inf')
    def sample(self, t0, t1, t2):
        rtt = t2-t0
        if rtt<0 or rtt>2_000_000: return
        if rtt <= self.best:
            self.best = rtt
            self.offset = (t0+t2)//2 - t1

def test_clock():
    print("\n== 3. 시계 동기 (비대칭 지연에서 오프셋 추정) ==")
    # 실제: source_clock = local_clock + true_offset. 목표: offset 추정 ≈ true_offset
    # 정의: source_clock = local_clock + src_ahead. offset(추정대상) = local - source = -src_ahead
    src_ahead = 5_000_000  # 소스가 로컬보다 5초 앞섬
    expected_offset = -src_ahead
    cs = ClockSync()
    rng = random.Random(1)
    for _ in range(40):
        t0 = rng.randint(0, 10**9)                 # 로컬 송신
        up = rng.randint(2000, 40000)              # 상행 지연
        down = rng.randint(2000, 40000)            # 하행 지연
        t1 = (t0+up) + src_ahead                    # 소스 시계로 찍은 수신시각
        t2 = t0 + up + down                         # 로컬 수신
        cs.sample(t0, t1, t2)
    err = abs(cs.offset - expected_offset)
    # 최소 RTT 샘플이면 오차 ≈ (up-down)/2, 최대 ~19ms
    check("오프셋 추정 오차 < 25ms", err < 25000, f"err={err/1000:.1f}ms offset={cs.offset} expected={expected_offset}")
    # toLocal 변환 검증
    src_ts = 5_500_000
    local = src_ts - cs.offset  # toLocal(srcTs) = srcTs + offset? 확인!
    # 실제 코드: toLocal = srcTs + offset, offset=(t0+t2)/2 - t1(=src)
    # 즉 offset은 (local - source). local = src + offset
    local2 = src_ts + cs.offset
    # source가 local보다 앞서므로 local < source → local2 < src_ts 이어야
    check("toLocal = srcTs + offset 부호 정합", local2 < src_ts, f"local2={local2} src={src_ts} off={cs.offset}")

# ---------- 4. 다기기 동기 재생 (핵심) ----------
# 해석 모델: 한 프레임(소스시각 ts)이 스피커에서 실제로 나오는 로컬 벽시계는
#   emit_local = max(  ideal = toLocal(ts) + delay + nudge,           # 스케줄 목표
#                       floor = arrival_local + device_out_latency )  # 물리 하한
#   arrival_local = toLocal(ts) + net_delay,  toLocal(ts)=ts+offset (offset=local-source)
# 소스시계로 환산: emit_source = emit_local - offset
#                = ts + max( delay+nudge , net_delay + device_out_latency )
# → offset/net/device 가 delay 안에 흡수되면 모든 스피커가 ts+delay+nudge 로 완전 일치.
#   흡수 못 하면(net+device > delay) 그 기기만 (net+device-delay) 만큼 늦음.
def emit_source_domain(device_lat_ms, net_delay_ms, clock_offset_us, nudge_ms,
                       delay_ms=60, has_sync=True, source_ts=1_000_000):
    offset = clock_offset_us if has_sync else 0
    ideal_local = source_ts + offset + (delay_ms + nudge_ms)*1000
    arrival_local = source_ts + offset + net_delay_ms*1000
    floor_local = arrival_local + device_lat_ms*1000
    if has_sync:
        emit_local = max(ideal_local, floor_local)
        return emit_local - offset            # 소스시계 환산
    else:
        # 무동기: 첫 패킷 도착 기준 잠정오프셋 → 기기마다 시작점이 제각각(offset 미보정)
        # 근사: emit_local ≈ arrival_local + max(delay, device_lat); 소스환산 시 offset 안 빠짐
        emit_local = arrival_local + max(delay_ms, device_lat_ms)*1000
        return emit_local - offset + offset   # offset 미보정 반영 = emit_local (오프셋 남음)

def test_multidevice():
    print("\n== 4. 다기기 동기 재생 (같은 소스 샘플이 같은 벽시계에 나오는가) ==")
    specs = [
        dict(device_lat_ms=20,  net_delay_ms=8,  clock_offset_us=0,         nudge_ms=0),
        dict(device_lat_ms=45,  net_delay_ms=15, clock_offset_us=3_000_000, nudge_ms=0),
        dict(device_lat_ms=30,  net_delay_ms=25, clock_offset_us=-1_500_000,nudge_ms=0),
    ]
    res=[]
    for i,s in enumerate(specs):
        e = emit_source_domain(**s)
        res.append(e)
        print(f"    스피커{i}: 방출(소스시계) {e/1000:.1f}ms  "
              f"[기기 {s['device_lat_ms']}ms · 망 {s['net_delay_ms']}ms · 오프셋 {s['clock_offset_us']/1000:.0f}ms]")
    spread=max(res)-min(res)
    check("스피커 간 방출 시차 < 5ms (delay가 망+기기 흡수)", spread < 5000, f"spread={spread/1000:.1f}ms")

def test_latency_floor():
    print("\n== 4b. 지연 하한 버그: delay < (망+기기지연) 인 스피커는 늦음 ==")
    # delay=60ms인데 한 스피커의 망+기기 = 100ms → 40ms 늦게 나옴 (실사용 증상!)
    a = emit_source_domain(device_lat_ms=20, net_delay_ms=8,  clock_offset_us=0, nudge_ms=0, delay_ms=60)
    b = emit_source_domain(device_lat_ms=90, net_delay_ms=15, clock_offset_us=0, nudge_ms=0, delay_ms=60)
    lag=(b-a)/1000
    print(f"    빠른기기 {a/1000:.1f}ms vs 느린기기(버퍼90ms) {b/1000:.1f}ms → 시차 {lag:.1f}ms")
    check("이 조건에서 시차 발생을 시뮬이 포착", lag > 10, f"lag={lag:.1f}ms")
    # 완화책 검증: 느린 기기에서 delay를 키우면(=대기시간↑) 정렬 회복
    a2 = emit_source_domain(device_lat_ms=20, net_delay_ms=8,  clock_offset_us=0, nudge_ms=0, delay_ms=120)
    b2 = emit_source_domain(device_lat_ms=90, net_delay_ms=15, clock_offset_us=0, nudge_ms=0, delay_ms=120)
    check("delay를 120ms로 키우면 정렬 회복", abs(b2-a2) < 5000, f"spread={(b2-a2)/1000:.1f}ms")

def test_multidevice_nosync():
    print("\n== 4c. 시계동기 없이(구버전) — 대조군 ==")
    res=[]
    for s in [dict(device_lat_ms=20,net_delay_ms=8,clock_offset_us=0,nudge_ms=0,has_sync=False),
              dict(device_lat_ms=45,net_delay_ms=15,clock_offset_us=3_000_000,nudge_ms=0,has_sync=False)]:
        res.append(emit_source_domain(**s))
    print(f"    (참고) 무동기 시차 = {(max(res)-min(res))/1000:.0f}ms — 시계오프셋만큼 어긋남(동기가 필요한 이유)")

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
    test_clock()
    test_multidevice()
    test_latency_floor()
    test_multidevice_nosync()
    test_jitter()
    test_roles()
    print("\n"+"="*50)
    if FAIL:
        print(f"실패 {len(FAIL)}건:")
        for f in FAIL: print("  ✗", f)
    else:
        print("전체 통과 ✓")
