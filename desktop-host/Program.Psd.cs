using System.Drawing;
using System.Drawing.Imaging;

namespace CrushExplorer;

// Minimal Photoshop (.psd) decoder for thumbnails. Reads the flattened composite image
// ("Maximize Compatibility" data) and box-downsamples it while streaming, so huge files
// never need a full-size bitmap in memory. Windows has no built-in PSD codec.
public partial class Program
{
    private static int ReadBE16(Stream s)
    {
        int a = s.ReadByte(), b = s.ReadByte();
        if ((a | b) < 0) throw new EndOfStreamException();
        return (a << 8) | b;
    }

    private static uint ReadBE32(Stream s)
    {
        uint v = 0;
        for (int i = 0; i < 4; i++)
        {
            int b = s.ReadByte();
            if (b < 0) throw new EndOfStreamException();
            v = (v << 8) | (uint)b;
        }
        return v;
    }

    private static void ReadExactly(Stream s, byte[] buf, int count)
    {
        int off = 0;
        while (off < count)
        {
            int n = s.Read(buf, off, count - off);
            if (n <= 0) throw new EndOfStreamException();
            off += n;
        }
    }

    // PackBits decode of one scanline into dst (exactly dstLen bytes expected).
    private static bool UnpackBits(byte[] src, int srcLen, byte[] dst, int dstLen)
    {
        int si = 0, di = 0;
        while (di < dstLen && si < srcLen)
        {
            int n = (sbyte)src[si++];
            if (n >= 0)
            {
                int cnt = n + 1;
                if (si + cnt > srcLen || di + cnt > dstLen) return false;
                Buffer.BlockCopy(src, si, dst, di, cnt);
                si += cnt; di += cnt;
            }
            else if (n != -128)
            {
                int cnt = 1 - n;
                if (si >= srcLen || di + cnt > dstLen) return false;
                byte v = src[si++];
                Array.Fill(dst, v, di, cnt);
                di += cnt;
            }
        }
        return di == dstLen;
    }

    private static bool TryGeneratePsdThumbnail(string filePath, int targetSize, string outPngPath)
    {
        try
        {
            using var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite, 1 << 16);

            // Header
            if (ReadBE32(fs) != 0x38425053) return false; // "8BPS"
            if (ReadBE16(fs) != 1) return false;          // version 1 = PSD (2 = PSB, unsupported)
            fs.Seek(6, SeekOrigin.Current);
            int channels = ReadBE16(fs);
            uint hU = ReadBE32(fs), wU = ReadBE32(fs);
            int depth = ReadBE16(fs);
            int mode = ReadBE16(fs);
            if (wU == 0 || hU == 0 || wU > 30000 || hU > 30000) return false;
            int width = (int)wU, height = (int)hU;
            if (depth != 8 && depth != 16) return false;

            // Colour mode data (palette for indexed)
            uint cmLen = ReadBE32(fs);
            byte[]? palette = null;
            if (mode == 2 && cmLen >= 768)
            {
                palette = new byte[768];
                ReadExactly(fs, palette, 768);
                fs.Seek(cmLen - 768, SeekOrigin.Current);
            }
            else
            {
                fs.Seek(cmLen, SeekOrigin.Current);
            }

            // Image resources, layer & mask info: skip both
            fs.Seek(ReadBE32(fs), SeekOrigin.Current);
            fs.Seek(ReadBE32(fs), SeekOrigin.Current);

            int compression = ReadBE16(fs);
            if (compression != 0 && compression != 1) return false; // ZIP variants not used for composite

            int colorChannels = mode switch
            {
                0 or 1 or 2 or 8 => 1, // bitmap(unsupported below)/gray/indexed/duotone
                3 => 3,
                4 => 4,
                _ => 0                  // Lab, multichannel, etc.
            };
            if (colorChannels == 0 || mode == 0) return false;
            if (mode == 2 && (palette == null || depth != 8)) return false;
            if (channels < colorChannels) return false;

            // Destination size (never upscale)
            double scale = Math.Min((double)targetSize / width, (double)targetSize / height);
            if (scale > 1.0) scale = 1.0;
            int dstW = Math.Max(1, (int)Math.Round(width * scale));
            int dstH = Math.Max(1, (int)Math.Round(height * scale));

            int bytesPerSample = depth / 8;
            int rowBytes = width * bytesPerSample;

            var sums = new long[colorChannels][];
            for (int c = 0; c < colorChannels; c++) sums[c] = new long[dstW * dstH];
            var counts = new int[dstW * dstH];

            var xMap = new int[width];
            for (int x = 0; x < width; x++) xMap[x] = Math.Min(dstW - 1, (int)((long)x * dstW / width));

            // RLE: per-row byte counts for every channel precede the data.
            ushort[]? rowLens = null;
            if (compression == 1)
            {
                int total = channels * height;
                rowLens = new ushort[total];
                var tmp = new byte[total * 2];
                ReadExactly(fs, tmp, tmp.Length);
                for (int i = 0; i < total; i++) rowLens[i] = (ushort)((tmp[i * 2] << 8) | tmp[i * 2 + 1]);
            }

            var rowBuf = new byte[rowBytes];
            var packed = new byte[rowBytes * 2 + 16];

            for (int c = 0; c < channels; c++)
            {
                bool keep = c < colorChannels;
                for (int y = 0; y < height; y++)
                {
                    if (compression == 0)
                    {
                        if (!keep)
                        {
                            fs.Seek(rowBytes, SeekOrigin.Current);
                            continue;
                        }
                        ReadExactly(fs, rowBuf, rowBytes);
                    }
                    else
                    {
                        int len = rowLens![c * height + y];
                        if (!keep)
                        {
                            fs.Seek(len, SeekOrigin.Current);
                            continue;
                        }
                        if (len > packed.Length) return false;
                        ReadExactly(fs, packed, len);
                        if (!UnpackBits(packed, len, rowBuf, rowBytes)) return false;
                    }

                    int dy = Math.Min(dstH - 1, (int)((long)y * dstH / height));
                    int rowBase = dy * dstW;
                    var sum = sums[c];
                    for (int x = 0; x < width; x++)
                    {
                        int v = rowBuf[x * bytesPerSample]; // 16-bit: big-endian, high byte
                        sum[rowBase + xMap[x]] += v;
                    }
                    if (c == 0)
                    {
                        for (int x = 0; x < width; x++) counts[rowBase + xMap[x]]++;
                    }
                }
            }

            // Compose BGRA output
            using var bmp = new Bitmap(dstW, dstH, PixelFormat.Format32bppArgb);
            var data = bmp.LockBits(new Rectangle(0, 0, dstW, dstH), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
            try
            {
                var line = new byte[dstW * 4];
                for (int y = 0; y < dstH; y++)
                {
                    for (int x = 0; x < dstW; x++)
                    {
                        int i = y * dstW + x;
                        int n = Math.Max(1, counts[i]);
                        int r, g, b;
                        if (mode == 3)
                        {
                            r = (int)(sums[0][i] / n); g = (int)(sums[1][i] / n); b = (int)(sums[2][i] / n);
                        }
                        else if (mode == 4)
                        {
                            // Photoshop stores CMYK inverted (255 = no ink)
                            int cc = (int)(sums[0][i] / n), mm = (int)(sums[1][i] / n);
                            int yy = (int)(sums[2][i] / n), kk = (int)(sums[3][i] / n);
                            r = cc * kk / 255; g = mm * kk / 255; b = yy * kk / 255;
                        }
                        else if (mode == 2)
                        {
                            int idx = (int)(sums[0][i] / n);
                            r = palette![idx]; g = palette[256 + idx]; b = palette[512 + idx];
                        }
                        else
                        {
                            r = g = b = (int)(sums[0][i] / n);
                        }
                        line[x * 4 + 0] = (byte)b;
                        line[x * 4 + 1] = (byte)g;
                        line[x * 4 + 2] = (byte)r;
                        line[x * 4 + 3] = 255;
                    }
                    System.Runtime.InteropServices.Marshal.Copy(line, 0, data.Scan0 + y * data.Stride, line.Length);
                }
            }
            finally { bmp.UnlockBits(data); }

            var tmpPath = outPngPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
            bmp.Save(tmpPath, ImageFormat.Png);
            File.Move(tmpPath, outPngPath, overwrite: true);
            return true;
        }
        catch
        {
            return false;
        }
    }
}
