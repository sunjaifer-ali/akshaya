export function CentreCredit({ place = "page" }: { place?: "page" | "side" }) {
  const line = "Developed for Akshaya Thrikkadeeri by Jaifer M";
  if (place === "side") {
    return <p className="no-print px-4 pb-4 text-[10px] leading-snug text-faint">{line}</p>;
  }
  return <p className="no-print mt-8 text-center text-[11px] text-faint">{line}</p>;
}