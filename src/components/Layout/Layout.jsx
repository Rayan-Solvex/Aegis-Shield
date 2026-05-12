import React, { useState } from 'react';
import { Sidebar } from './Sidebar.jsx';
import { Header } from './Header.jsx';

const SIDEBAR_WIDTH = 256;
const SIDEBAR_COLLAPSED_WIDTH = 72;

export function Layout({ children }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const sidebarWidth = sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;

  return (
    <div className="min-h-screen bg-aegis-bg circuit-bg">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((v) => !v)}
      />
      <Header sidebarWidth={sidebarWidth} />
      <main
        className="pt-16 min-h-screen transition-all duration-300"
        style={{ paddingLeft: sidebarWidth }}
      >
        <div className="p-6 lg:p-8 max-w-6xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
