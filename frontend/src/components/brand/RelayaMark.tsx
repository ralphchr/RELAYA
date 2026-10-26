import { copy } from "../../copy/en.js";

const LOGO_SRC = "/assets/relaya-logo.png";

/** The supplied Relaya mark, used as-is (never redrawn). */
export function RelayaMark({ size = 30, label = false }: { size?: number; label?: boolean }) {
  return <img className="brand-logo" src={LOGO_SRC} width={size} height={size} alt={label ? copy.brand.name : ""} />;
}

export function RelayaLockup({ size = 32 }: { size?: number }) {
  return (
    <span className="brand">
      <RelayaMark size={size} />
      <span className="wordmark">RELAYA</span>
    </span>
  );
}
