import { useEffect, useState } from 'react';
import { Icon } from '../ui/icons';
import { Logo } from '../ui/logo';
import { api } from '../api';
import { useStore } from '../store';

export function TitleBar() {
  const snapshot = useStore((s) => s.snapshot);
  const setSwitcherOpen = useStore((s) => s.setSwitcherOpen);
  const setView = useStore((s) => s.setView);
  const switchVault = useStore((s) => s.switchVault);
  const settings = snapshot?.settings;
  const initials =
    (snapshot?.vaultName ?? 'SK').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || 'SK';

  // Window controls follow the conventions of the desktop they are drawn on:
  // lights on the left for macOS, buttons on the right everywhere else.
  const onMac = api.platform() === 'darwin';

  const toggleMargin = () => {
    if (settings) void api.setSettings({ marginOn: !settings.marginOn });
  };

  return (
    <header className={`titlebar${onMac ? '' : ' titlebar--right-controls'}`}>
      <div className="titlebar__l">
        {onMac && <TrafficLights />}
        <div className="titlebar__brand">
          <Logo size={19} variant={settings?.logoVariant ?? 'sigil'} withText />
        </div>
      </div>

      <button className="cmdbar" onClick={() => setSwitcherOpen(true)} title="Search — ⌘K">
        <Icon name="search" size={14} />
        <span className="cmdbar__txt">Search notes, tasks, commands</span>
        <span className="cmdbar__kbd">
          <span className="kbd">⌘</span>
          <span className="kbd">K</span>
        </span>
      </button>

      <div className="titlebar__r">
        <button
          className={'ic-btn' + (settings?.marginOn ? ' is-on' : '')}
          title="Toggle right panel — ⌘B"
          onClick={toggleMargin}
        >
          <Icon name="panelRight" size={15} />
        </button>
        <button className="ic-btn" title="Settings" onClick={() => setView('settings')}>
          <Icon name="gear" size={15} />
        </button>
        <button
          className="vault-badge"
          title={`Vault: ${snapshot?.vaultName ?? '—'}\n${snapshot?.vaultPath ?? ''}\nClick to switch vault`}
          onClick={switchVault}
        >
          {initials}
        </button>
        {!onMac && <WindowControls />}
      </div>
    </header>
  );
}

function TrafficLights() {
  return (
    <div className="traffic">
      <span title="Close" onClick={() => void api.closeWindow()} />
      <span title="Minimize" onClick={() => void api.minimize()} />
      <span title="Maximize" onClick={() => void api.toggleMaximize()} />
    </div>
  );
}

/** Minimise, maximise, close — in that order, on the right, as Windows and most Linux desktops draw them. */
function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    void (window.skald.invoke('window:isMaximized') as Promise<boolean>).then(setMaximized);
    return window.skald.onWindowMaximized(setMaximized);
  }, []);

  return (
    <div className="wincontrols">
      <button className="wc" title="Minimize" onClick={() => void api.minimize()}>
        <Icon name="winMinimize" size={18} />
      </button>
      <button
        className="wc"
        title={maximized ? 'Restore' : 'Maximize'}
        onClick={() => void api.toggleMaximize().then(setMaximized)}
      >
        <Icon name={maximized ? 'winRestore' : 'winMaximize'} size={18} />
      </button>
      <button className="wc wc--close" title="Close" onClick={() => void api.closeWindow()}>
        <Icon name="winClose" size={18} />
      </button>
    </div>
  );
}
