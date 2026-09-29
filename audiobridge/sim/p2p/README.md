# Wi-Fi Direct 가상 시뮬레이션

실기기 없이 **실제 앱 소스 `android/.../net/WifiDirect.kt`를 그대로 컴파일**해 가상 Android 위의 가상 폰 2대로 돌린다.
수정 전 v2.8 원본(`baseline/WifiDirectV28.kt`)도 같은 조건에서 돌려 결과를 나란히 보여 준다.

```bash
bash audiobridge/sim/p2p/run.sh      # JDK 17+ 필요, Kotlin 2.0.21은 처음 한 번 ~/.cache에 내려받음
```

| 파일 | 역할 |
|---|---|
| `android-stubs/` | `WifiP2pManager`·`Context`·`Handler` 등 앱이 쓰는 Android API를 같은 모양으로 흉내 낸 Java 대역. `sim.VirtualClock`이 모든 콜백을 가상 시간 순서로 실행(45초 타임아웃도 즉시) |
| `VirtualP2p.kt` | 가상 세계(초대·그룹 형성·sticky 브로드캐스트), `MainActivity` 배선, `BridgeEngine`의 Wi-Fi Direct 진입점 모델, 시나리오 13개 |
| `baseline/WifiDirectV28.kt` | 비교용 v2.8 원본 (패키지명만 변경) |

가상 프레임워크가 재현하는 실제 Android 동작: `CONNECTION_CHANGED`·`STATE_CHANGED`는 sticky(리시버를 등록할 때마다 재전달),
미등록 중 일반 브로드캐스트 유실, 연결 요청 직후 `groupFormed=false` 알림, 초대 무시 시 무알림, `discoverPeers` BUSY 실패,
주변 기기 없음 시 `PEERS_CHANGED` 없음, 검색 직후 빈 목록 알림, 프레임워크의 채널 끊김.

한계: 무선 구간(전파·지연·패킷 손실)과 제조사별 P2P 편차, 실제 권한 대화상자는 흉내 내지 않는다.
`BridgeEngine`은 오디오·소켓 의존성이 커서 `onWifiDirectConnected → connect → addLink` 순서만 옮긴 모델을 쓴다.
따라서 이 시뮬레이션은 **앱 쪽 상태 처리 논리**를 검증하며, 실기기 확인을 대신하지 않는다.
