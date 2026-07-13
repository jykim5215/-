namespace AudioBridge.Win;

/// <summary>AudioBridge protocol v1 audio header (24-byte, big endian).</summary>
public static class Protocol
{
    public const int Version = 1;
    public const int HeaderSize = 24;
    public const int CodecPcm16 = 0;
    public const int MaxPayload = 1400;
    public const int FlagFirst = 0x01;

    public const int DefaultCtlPort = 48550;
    public const int DiscoveryPort = 48551;
    public const int DefaultModeBPort = 48553;

    public const int SampleRate = 48000;
    public const int FrameMs = 5;
    public const int DefaultPlayoutDelayMs = 400;

    public static int FrameBytes(int channels) => SampleRate / 1000 * FrameMs * 2 * channels;

    public static int BuildPacket(
        byte[] outBuf, ReadOnlySpan<byte> payload, int seq,
        int sampleRate, int channels, int flags, long timestampUs)
    {
        outBuf[0] = 0x41;
        outBuf[1] = 0x42;
        outBuf[2] = Version;
        outBuf[3] = CodecPcm16;
        outBuf[4] = (byte)channels;
        outBuf[5] = (byte)flags;
        outBuf[6] = (byte)(payload.Length >> 8);
        outBuf[7] = (byte)payload.Length;
        WriteInt(outBuf, 8, seq);
        WriteInt(outBuf, 12, sampleRate);
        WriteLong(outBuf, 16, timestampUs);
        payload.CopyTo(outBuf.AsSpan(HeaderSize));
        return HeaderSize + payload.Length;
    }

    public static PacketInfo? ParseHeader(ReadOnlySpan<byte> data)
    {
        if (data.Length < HeaderSize) return null;
        if (data[0] != 0x41 || data[1] != 0x42) return null;
        if (data[2] != Version || data[3] != CodecPcm16) return null;

        int channels = data[4];
        if (channels is < 1 or > 2) return null;
        int flags = data[5];
        int payloadLen = (data[6] << 8) | data[7];
        if (payloadLen <= 0 || payloadLen > MaxPayload) return null;
        int seq = ReadInt(data, 8);
        int rate = ReadInt(data, 12);
        if (rate is < 8000 or > 192000) return null;
        long timestampUs = ReadLong(data, 16);
        if (timestampUs < 0) return null;
        return new PacketInfo(channels, flags, payloadLen, seq, rate, timestampUs);
    }

    private static void WriteInt(byte[] b, int off, int v)
    {
        b[off] = (byte)(v >> 24);
        b[off + 1] = (byte)(v >> 16);
        b[off + 2] = (byte)(v >> 8);
        b[off + 3] = (byte)v;
    }

    private static void WriteLong(byte[] b, int off, long v)
    {
        for (int i = 0; i < 8; i++) b[off + i] = (byte)(v >> (56 - 8 * i));
    }

    private static int ReadInt(ReadOnlySpan<byte> b, int off) =>
        (b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3];

    private static long ReadLong(ReadOnlySpan<byte> b, int off)
    {
        long value = 0;
        for (int i = 0; i < 8; i++) value = (value << 8) | b[off + i];
        return value;
    }
}

public record PacketInfo(
    int Channels,
    int Flags,
    int PayloadLen,
    int Seq,
    int SampleRate,
    long TimestampUs);
