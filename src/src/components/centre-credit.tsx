export function CentreCredit({ place = "page" }: { place?: "page" | "side" }) {
  if (place === "side") {
    return (
      <p className="no-print px-4 pb-4 text-[10px] leading-snug text-faint">
        Jaifer Ali M
        <br />
        9995080431
      </p>
    );
  }
  return <p className="no-print mt-8 text-center text-[11px] text-faint">Jaifer Ali M · 9995080431</p>;
}
