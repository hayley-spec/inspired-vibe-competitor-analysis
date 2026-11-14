import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompetitiveProfile, ProcessingComparison } from '../client/src/components/competitive-profile';
const noop = () => {};
test('Step 4 has two URL inputs and a third email field with accessible labels and approved CTA', () => {
 const html = renderToStaticMarkup(<CompetitiveProfile ownUrl="" competitorUrl="" onOwnUrlChange={noop} onCompetitorUrlChange={noop} onSubmit={noop} isPending={false} />);
 assert.equal((html.match(/<input /g) || []).length, 3);
 assert.equal((html.match(/type="email"/g) || []).length, 1);
 assert.ok(html.includes('Your Company’s Website'));
 assert.ok(html.includes('Competitor’s Website'));
 assert.ok(html.includes('Compare My Company'));
 assert.ok(!html.includes('Instagram Profile'));
 assert.ok(!html.includes('Founder’s Name'));
 assert.ok(!html.includes('1–10'));
});
test('validation error retains form, processing shows two websites with no simulated completion', () => {
 const html = renderToStaticMarkup(<CompetitiveProfile ownUrl="" competitorUrl="" onOwnUrlChange={noop} onCompetitorUrlChange={noop} onSubmit={noop} isPending={false} error="Enter your company’s website to continue." />);
 assert.ok(html.includes('role="alert"'));
 assert.ok(html.includes('<form'));
 const processing = renderToStaticMarkup(<ProcessingComparison ownUrl="https://own.example/" competitorUrl="https://competitor.example/" />);
 assert.ok(processing.includes('https://own.example/'));
 assert.ok(processing.includes('https://competitor.example/'));
 assert.ok(processing.replace(/<[^>]+>/g, '').includes('Comparing your company and your selected competitor…'));
 assert.ok(!processing.includes('<form'));
});

