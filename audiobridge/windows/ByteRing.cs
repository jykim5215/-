namespace AudioBridge.Win;

/// <summary>고정 크기 바이트 링 버퍼. 가득 차면 오래된 데이터부터 버린다.</summary>
public sealed class ByteRing
{
    private readonly byte[] _buf;
    private int _head; // 읽기 위치
    private int _count;
    private readonly object _lock = new();

    public ByteRing(int capacity) => _buf = new byte[capacity];

    public int Available { get { lock (_lock) return _count; } }

    public void Write(ReadOnlySpan<byte> data)
    {
        lock (_lock)
        {
            foreach (byte b in data)
            {
                if (_count == _buf.Length)
                {
                    _head = (_head + 1) % _buf.Length; // 가장 오래된 바이트 폐기
                    _count--;
                }
                _buf[(_head + _count) % _buf.Length] = b;
                _count++;
            }
        }
    }

    /// <summary>len 바이트가 모두 있으면 읽어서 true, 부족하면 false.</summary>
    public bool Read(byte[] dst, int len)
    {
        lock (_lock)
        {
            if (_count < len) return false;
            for (int i = 0; i < len; i++)
            {
                dst[i] = _buf[_head];
                _head = (_head + 1) % _buf.Length;
            }
            _count -= len;
            return true;
        }
    }

    public void Clear()
    {
        lock (_lock) { _head = 0; _count = 0; }
    }
}
