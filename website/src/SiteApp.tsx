import React from 'react';
import { DeployGuide } from './components/DeployGuide';
import { FeatureGrid } from './components/FeatureGrid';
import { Hero } from './components/Hero';
import { MetricsStrip } from './components/MetricsStrip';
import { ShotGallery } from './components/ShotGallery';
import { SiteFooter } from './components/SiteFooter';
import { SiteHeader } from './components/SiteHeader';
import { StatusPanel } from './components/StatusPanel';

export function SiteApp() {
  return (
    <div className="app-shell">
      <SiteHeader />
      <main className="site-shell">
        <Hero />
        <MetricsStrip />
        <FeatureGrid />
        <ShotGallery />
        <StatusPanel />
        <DeployGuide />
      </main>
      <SiteFooter />
    </div>
  );
}
