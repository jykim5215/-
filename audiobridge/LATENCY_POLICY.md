# AudioBridge 지연 정책

## 결론

AudioBridge v2.6.16부터 모든 네트워크 스피커는 소스 타임스탬프보다 **400ms 늦은 공통 시각**을
기본 재생 목표로 사용한다. 수신 기기별 수동 보정은 **추가 지연 0~300ms**만 허용한다.
음수를 없앤 이유는 이미 지나간 하드웨어 출력 시각으로 프레임을 보낼 수 없기 때문이다.

공개된 측정과 플랫폼 상한을 조합한 **공학 기준선은 100ms**다. 실제 제품 기본값 400ms는
사용자 선택에 따라 여기에 300ms 안전 여유를 더한 안정성 우선값이다. 즉 400ms가 일반 Wi-Fi의
평균 지연이라는 뜻은 아니며, 절대 지연을 줄이는 것보다 늦게 도착하는 패킷을 안정적으로 흡수한다.

| 구성 요소 | 공개 근거 | 정책에 잡은 여유 |
|---|---|---:|
| 정상적인 단일 Wi-Fi 홉 | 802.11 연결은 보통 10ms 미만이라는 실험 문헌 요약 | 10ms |
| Android 출력 | `android.hardware.audio.low_latency` 보장도 연속 출력 지연 45ms 이하이며 모델별 편차가 큼 | 45ms |
| 오디오 프레임 | AudioBridge PCM 프레임 1개 | 5ms |
| 캡처·스케줄러·재전송 변동 | 기기·드라이버·혼잡 차이와 늦은 패킷 흡수 | 40ms |
| **공학 기준선 합계** | | **100ms** |
| **안정성 우선 추가 여유** | 혼잡·절전·제조사 DSP의 긴 꼬리 지연을 넉넉히 흡수 | **300ms** |
| **제품 기본값** | | **400ms** |

Windows 공유 모드의 기본 오디오 버퍼는 약 10ms이며 드라이버가 더 작은 주기를 지원할 수 있다.
따라서 Android의 45ms 출력 상한을 수신 경로의 보수적 기준으로 택했다. RFC 7005가 설명하듯
고정 디지터 버퍼는 정상 도착 패킷에 일정한 명목 지연을 적용하고, 지나치게 늦은 패킷은 재생
마감 시각을 놓치면 폐기한다. AudioBridge의 400ms 공통 목표도 이 원칙을 따른다.

## 구조적 한계

AudioPlaybackCapture로 다른 앱의 소리를 복제할 때, AudioBridge는 **그 앱이 소스 기기 자체
스피커로 내보내는 원음 경로를 지연시킬 권한이 없다**. 네트워크 스피커는 캡처·전송·재생 경로를
반드시 지나므로 소스 기기의 원음보다 늦다. 따라서 소스 기기와 네트워크 스피커를 동시에 울려
완전히 맞추는 것은 이 구조로는 불가능하다.

실사용 권장 방식은 소스 기기를 음소거하고 AudioBridge에 연결된 스피커들만 듣는 것이다.
연결된 스피커끼리는 공통 타임스탬프, 시계 동기, 하드웨어 재생 헤드로 맞춘다. 스피커 내부 DSP처럼
OS가 관측하지 못하는 지연이 남으면 더 빠르게 들리는 수신기만 `추가 지연`으로 늦춘다.

## 참고 자료

- [Android Developers — Audio latency](https://developer.android.com/ndk/guides/audio/audio-latency)
- [Microsoft Learn — Low Latency Audio](https://learn.microsoft.com/en-us/windows-hardware/drivers/audio/low-latency-audio)
- [IETF RFC 7005 — De-Jitter Buffer Operation](https://datatracker.ietf.org/doc/html/rfc7005#section-3)
- [Microsoft Research — Is IEEE 802.11 ready for VoIP?](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/VoWiFi_WebMedia2006.pdf)

이 기본값은 안정성 우선 환경용이다. 공유기 혼잡, 절전 모드, Bluetooth 출력, 제조사 DSP는 400ms보다도
큰 변동을 만들 수 있다. 다음 고도화 단계는 실기기 마이크 펄스 측정으로 각 출력 경로의 추가 지연을
자동 추정하는 캘리브레이션이다.
