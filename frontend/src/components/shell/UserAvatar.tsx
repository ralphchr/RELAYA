import { useState } from "react";

export function UserAvatar({ avatarUrl, initials, className = "", ready = true }: { avatarUrl: string | null | undefined; initials: string; className?: string; ready?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <span className={`av${className ? ` ${className}` : ""}`} aria-hidden="true">
      {avatarUrl && failedUrl !== avatarUrl
        ? <img className="av-photo" src={avatarUrl} alt="" onError={() => setFailedUrl(avatarUrl)} />
        : <span className={`av-initials${ready ? " is-ready" : ""}`}>{initials}</span>}
    </span>
  );
}
