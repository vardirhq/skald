import type { ReactNode } from 'react';

export function SettingsRow({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <div className="settings__row">
      <div className="settings__row__l">
        <h3>{title}</h3>
        <p>{desc}</p>
      </div>
      <div className="settings__row__r">{children}</div>
    </div>
  );
}
