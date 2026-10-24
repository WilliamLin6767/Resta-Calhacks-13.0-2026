import { isPoll, isPoster, type PostLayout } from "@/lib/marketing/copy";

// A 1080-square post. The photo version is a browser preview (the JPEG is composed in image.tsx).
export default function PostFrame({
  layout,
  restaurant,
  dishName,
  headline,
  subhead,
  size = 1080,
  photoUrl,
  onPhotoError,
}: {
  layout: PostLayout;
  restaurant: string;
  dishName: string;
  headline: string;
  subhead: string;
  size?: number;
  photoUrl?: string;
  onPhotoError?: () => void;
}) {
  const u = (n: number) => Math.round((n * size) / 1080);
  const font = { fontFamily: "Poppins", display: "flex" as const };

  if (photoUrl) {
    const poll = isPoll(layout);
    const poster = isPoster(layout);
    return (
      <div style={{ position: "relative", width: size, height: size, overflow: "hidden", backgroundColor: "#1a1612", color: "#fff", fontFamily: "Poppins" }}>
        <img
          src={photoUrl}
          alt=""
          width={size}
          height={size}
          onError={onPhotoError}
          style={{ position: "absolute", inset: 0, width: size, height: size, objectFit: "cover" }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: poster
              ? "radial-gradient(circle at 50% 55%, rgba(16,12,8,0.72) 0%, rgba(16,12,8,0.25) 70%)"
              : "linear-gradient(to top, rgba(16,12,8,0.92) 0%, rgba(16,12,8,0.45) 32%, rgba(16,12,8,0) 62%, rgba(16,12,8,0.4) 100%)",
          }}
        />
        <div style={{ position: "absolute", top: u(36), left: u(40), right: u(40), fontSize: u(18), fontWeight: 600, letterSpacing: u(2.4) }}>{restaurant.toUpperCase()}</div>
        <div style={{ position: "absolute", left: u(40), right: u(40), bottom: poster ? undefined : u(40), top: poster ? "22%" : undefined, textAlign: poster ? "center" : "left" }}>
          <div style={{ fontSize: u(18), fontWeight: 600, letterSpacing: u(2), color: "#f0d48a" }}>{poll ? "SHOULD WE ADD THIS?" : dishName.toUpperCase()}</div>
          <div style={{ marginTop: u(8), fontSize: u(poll ? 40 : 52), fontWeight: 700, lineHeight: 1.05 }}>{poll ? dishName : headline}</div>
          {poll ? (
            <>
              {headline ? <div style={{ marginTop: u(8), fontSize: u(20), lineHeight: 1.3, color: "#f6efe2" }}>{headline}</div> : null}
              <div style={{ display: "flex", marginTop: u(16), justifyContent: poster ? "center" : "flex-start" }}>
                <div style={{ marginRight: u(10), borderRadius: u(999), border: "2px solid #f0d48a", padding: `${u(8)}px ${u(16)}px`, color: "#f0d48a", fontSize: u(18), fontWeight: 600 }}>Add it</div>
                <div style={{ borderRadius: u(999), border: "2px solid #fff", padding: `${u(8)}px ${u(16)}px`, fontSize: u(18), fontWeight: 600 }}>Not yet</div>
              </div>
            </>
          ) : (
            <div style={{ marginTop: u(10), fontSize: u(22), lineHeight: 1.3, color: "#f6efe2" }}>{subhead}</div>
          )}
        </div>
      </div>
    );
  }

  if (isPoll(layout)) {
    return (
      <div style={{ ...font, width: size, height: size, flexDirection: "column", justifyContent: "space-between", backgroundColor: "#101010", color: "#fbf6ea", padding: u(72) }}>
        <div style={{ ...font, fontSize: u(22), fontWeight: 600, letterSpacing: u(3), color: "#e8cc8a" }}>SHOULD WE ADD THIS?</div>
        <div style={{ ...font, flexDirection: "column" }}>
          <div style={{ ...font, fontSize: u(72), fontWeight: 700, lineHeight: 1.05 }}>{dishName}</div>
          <div style={{ ...font, marginTop: u(16), fontSize: u(28), lineHeight: 1.3, color: "#f4e6c4" }}>{headline}</div>
          <div style={{ ...font, marginTop: u(12), fontSize: u(24), lineHeight: 1.3, color: "#f4e6c4" }}>{subhead}</div>
          <div style={{ ...font, marginTop: u(36) }}>
            <div style={{ ...font, marginRight: u(16), borderRadius: u(999), border: "3px solid #e8cc8a", padding: `${u(14)}px ${u(28)}px`, color: "#e8cc8a", fontSize: u(28), fontWeight: 600 }}>Add it</div>
            <div style={{ ...font, borderRadius: u(999), border: "3px solid #f4e6c4", padding: `${u(14)}px ${u(28)}px`, color: "#f4e6c4", fontSize: u(28), fontWeight: 600 }}>Not yet</div>
          </div>
        </div>
        <div style={{ ...font, fontSize: u(22), color: "#f4e6c4" }}>Comment ADD or SKIP</div>
      </div>
    );
  }

  if (layout === "special") {
    return (
      <div
        style={{
          ...font,
          width: size,
          height: size,
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#1f2336",
          padding: u(72),
          color: "#fbf6ea",
        }}
      >
        <div style={{ ...font, fontSize: u(22), fontWeight: 600, letterSpacing: u(4), color: "#e8cc8a" }}>ON THE MENU</div>
        <div style={{ ...font, flexDirection: "column" }}>
          <div style={{ ...font, fontSize: u(78), fontWeight: 700, lineHeight: 1.05 }}>{headline}</div>
          <div style={{ ...font, marginTop: u(28), fontSize: u(32), fontWeight: 600, color: "#e8cc8a" }}>{dishName}</div>
        </div>
        <div style={{ ...font, flexDirection: "column" }}>
          <div style={{ ...font, fontSize: u(28), lineHeight: 1.35, color: "#f4e6c4" }}>{subhead}</div>
          <div style={{ ...font, marginTop: u(36), fontSize: u(22), fontWeight: 600 }}>{restaurant}</div>
        </div>
      </div>
    );
  }

  if (layout === "night") {
    return (
      <div style={{ ...font, width: size, height: size, backgroundColor: "#fbf6ea", color: "#1f2336" }}>
        <div style={{ width: u(28), height: size, backgroundColor: "#8c6110" }} />
        <div style={{ ...font, flex: 1, flexDirection: "column", justifyContent: "space-between", padding: u(72) }}>
          <div style={{ ...font, fontSize: u(22), fontWeight: 600, letterSpacing: u(3), color: "#8c6110" }}>{restaurant.toUpperCase()}</div>
          <div style={{ ...font, flexDirection: "column" }}>
            <div style={{ ...font, fontSize: u(76), fontWeight: 700, lineHeight: 1.05 }}>{headline}</div>
            <div
              style={{
                ...font,
                marginTop: u(32),
                alignSelf: "flex-start",
                backgroundColor: "#8c6110",
                color: "#fff",
                borderRadius: u(999),
                padding: `${u(12)}px ${u(28)}px`,
                fontSize: u(28),
                fontWeight: 600,
              }}
            >
              {dishName}
            </div>
          </div>
          <div style={{ ...font, fontSize: u(28), lineHeight: 1.35, color: "#404852" }}>{subhead}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        ...font,
        width: size,
        height: size,
        flexDirection: "column",
        backgroundColor: "#fbf6ea",
        color: "#1f2336",
      }}
    >
      <div style={{ height: u(18), backgroundColor: "#8c6110" }} />
      <div style={{ ...font, flex: 1, flexDirection: "column", justifyContent: "space-between", padding: u(72) }}>
        <div style={{ ...font, fontSize: u(22), fontWeight: 600, letterSpacing: u(3), color: "#8c6110" }}>{restaurant.toUpperCase()}</div>
        <div style={{ ...font, flexDirection: "column" }}>
          <div style={{ ...font, fontSize: u(36), fontWeight: 600, color: "#8c6110" }}>{dishName}</div>
          <div style={{ ...font, marginTop: u(16), fontSize: u(72), fontWeight: 700, lineHeight: 1.05 }}>{headline}</div>
        </div>
        <div style={{ ...font, fontSize: u(28), lineHeight: 1.35, color: "#404852" }}>{subhead}</div>
      </div>
    </div>
  );
}
