import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { isPoll, isPoster, type PostLayout } from "@/lib/marketing/copy";
import PostFrame from "@/lib/marketing/frame";

type FrameInput = {
  layout: PostLayout;
  restaurant: string;
  dishName: string;
  headline: string;
  subhead: string;
};

let fonts: { name: string; data: Buffer; weight: 600 | 700; style: "normal" }[] | null = null;

function poppins() {
  if (fonts) return fonts;
  const dir = join(process.cwd(), "node_modules/@fontsource/poppins/files");
  fonts = [
    { name: "Poppins", data: readFileSync(join(dir, "poppins-latin-600-normal.woff")), weight: 600, style: "normal" },
    { name: "Poppins", data: readFileSync(join(dir, "poppins-latin-700-normal.woff")), weight: 700, style: "normal" },
  ];
  return fonts;
}

const GRADIENT = Buffer.from(
  `<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#100c08" stop-opacity="0.45"/>
        <stop offset="0.18" stop-color="#100c08" stop-opacity="0"/>
        <stop offset="0.5" stop-color="#100c08" stop-opacity="0"/>
        <stop offset="0.72" stop-color="#100c08" stop-opacity="0.35"/>
        <stop offset="1" stop-color="#100c08" stop-opacity="0.9"/>
      </linearGradient>
    </defs>
    <rect width="1080" height="1080" fill="url(#g)"/>
  </svg>`,
);

// Type only. The canvas stays clear so the photo shows through.
const POSTER = Buffer.from(
  `<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="g" cx="50%" cy="55%" r="65%">
        <stop offset="0" stop-color="#100c08" stop-opacity="0.72"/>
        <stop offset="1" stop-color="#100c08" stop-opacity="0.2"/>
      </radialGradient>
    </defs>
    <rect width="1080" height="1080" fill="url(#g)"/>
  </svg>`,
);

function Overlay({ post }: { post: FrameInput }) {
  const poll = isPoll(post.layout);
  const poster = isPoster(post.layout);
  return (
    <div style={{ display: "flex", width: 1080, height: 1080, flexDirection: "column", justifyContent: poster ? "center" : "space-between", alignItems: poster ? "center" : "flex-start", padding: 64, fontFamily: "Poppins", color: "#fff", textAlign: poster ? "center" : "left" }}>
      <div style={{ display: "flex", fontSize: 22, fontWeight: 600, letterSpacing: 3 }}>{post.restaurant.toUpperCase()}</div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: poster ? "center" : "flex-start", marginTop: poster ? 28 : 0 }}>
        <div style={{ display: "flex", fontSize: 22, fontWeight: 600, letterSpacing: 2, color: "#f0d48a" }}>{poll ? "SHOULD WE ADD THIS?" : post.dishName.toUpperCase()}</div>
        <div style={{ display: "flex", marginTop: 12, fontSize: poll ? 56 : 68, fontWeight: 700, lineHeight: 1.05 }}>{poll ? post.dishName : post.headline}</div>
        {poll ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {post.headline ? <div style={{ display: "flex", marginTop: 12, fontSize: 28, lineHeight: 1.3, color: "#f6efe2" }}>{post.headline}</div> : null}
            <div style={{ display: "flex", marginTop: 24, justifyContent: poster ? "center" : "flex-start" }}>
              <div style={{ display: "flex", marginRight: 16, border: "3px solid #f0d48a", borderRadius: 999, padding: "12px 28px", color: "#f0d48a", fontSize: 28, fontWeight: 600 }}>Add it</div>
              <div style={{ display: "flex", border: "3px solid #fff", borderRadius: 999, padding: "12px 28px", fontSize: 28, fontWeight: 600 }}>Not yet</div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", marginTop: 16, fontSize: 30, lineHeight: 1.3, color: "#f6efe2" }}>{post.subhead}</div>
        )}
      </div>
    </div>
  );
}

async function textJpeg(post: FrameInput): Promise<Buffer> {
  const png = new ImageResponse(<PostFrame {...post} size={1080} />, {
    width: 1080,
    height: 1080,
    fonts: poppins(),
  });
  return sharp(Buffer.from(await png.arrayBuffer())).jpeg({ quality: 90 }).toBuffer();
}

// Full-bleed photo, a soft gradient, then the type. Without a photo, the plain frame is used.
export async function renderPostJpeg(post: FrameInput, photo?: Buffer): Promise<Buffer> {
  if (!photo) return textJpeg(post);
  const base = await sharp(photo).rotate().resize(1080, 1080, { fit: "cover", position: "attention" }).jpeg({ quality: 90 }).toBuffer();
  const shade = await sharp(isPoster(post.layout) ? POSTER : GRADIENT).png().toBuffer();
  const type = new ImageResponse(<Overlay post={post} />, { width: 1080, height: 1080, fonts: poppins() });
  return sharp(base)
    .composite([
      { input: shade },
      { input: Buffer.from(await type.arrayBuffer()) },
    ])
    .jpeg({ quality: 90 })
    .toBuffer();
}
