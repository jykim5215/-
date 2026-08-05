using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace AudioBridge.Win;

/// <summary>UDP 48551에서 "ABDISC?" 질의에 유니캐스트로 응답한다 (PROTOCOL.md §1).</summary>
public sealed class DiscoveryResponder : IDisposable
{
    private readonly int _ctlPort;
    private UdpClient? _udp;
    private volatile bool _running;

    public DiscoveryResponder(int ctlPort)
    {
        _ctlPort = ctlPort;
    }

    public bool Start()
    {
        try
        {
            _udp = new UdpClient(Protocol.DiscoveryPort);
        }
        catch (SocketException)
        {
            Console.WriteLine($"[검색] 포트 {Protocol.DiscoveryPort} 사용 중 — 자동 검색이 꺼져요 (폰에서 IP 직접 입력은 가능)");
            return false;
        }
        _running = true;
        var t = new Thread(Loop) { IsBackground = true, Name = "ab-discovery" };
        t.Start();
        Console.WriteLine("[검색] 폰의 검색에 응답할 준비 완료");
        return true;
    }

    private void Loop()
    {
        while (_running)
        {
            try
            {
                var ep = new IPEndPoint(IPAddress.Any, 0);
                byte[] data = _udp!.Receive(ref ep);
                // 정확한 질의에만, 질의를 보낸 주소로만 응답 (증폭/스캔 방지)
                if (data.Length == 7 && Encoding.ASCII.GetString(data) == "ABDISC?")
                {
                    var reply = Encoding.UTF8.GetBytes(
                        "ABDISC!" + JsonSerializer.Serialize(new { name = Config.Name, version = Protocol.Version, ctlPort = _ctlPort }));
                    _udp.Send(reply, reply.Length, ep);
                }
            }
            catch
            {
                if (!_running) return;
            }
        }
    }

    public void Dispose()
    {
        _running = false;
        _udp?.Dispose();
    }
}
