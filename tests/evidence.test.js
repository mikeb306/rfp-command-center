import test from 'node:test';
import assert from 'node:assert/strict';
import { matchEvidenceForRequirement, matchEvidenceForQuery } from '../src/lib/evidence.js';
import { buildComplianceMatrix } from '../src/lib/compliance.js';

test('matchEvidenceForRequirement ranks evidence by req type and term overlap', () => {
  const requirement = {
    reqId: 'r1',
    reqType: 'security',
    mustHave: true,
    statement: 'Must implement MFA and encryption for remote access.'
  };
  const assets = [
    {
      evidenceId: 'e-security',
      title: 'Security Program Case Study',
      summary: 'Delivered MFA rollout and encryption controls for utility clients.',
      tags: ['security', 'mfa', 'encryption'],
      reqTypes: ['security']
    },
    {
      evidenceId: 'e-pricing',
      title: 'Pricing Workbook',
      summary: 'Rate card and cost assumptions.',
      tags: ['pricing'],
      reqTypes: ['pricing']
    }
  ];

  const matches = matchEvidenceForRequirement(requirement, assets, 2);
  assert.equal(matches[0].evidenceId, 'e-security');
  assert.equal(matches.length >= 1, true);
});

test('buildComplianceMatrix auto-links evidence for must-have requirement', () => {
  const rows = buildComplianceMatrix(
    [
      {
        reqId: 'r1',
        reqType: 'security',
        mustHave: true,
        statement: 'Must implement MFA and encryption for remote access.'
      }
    ],
    [
      {
        evidenceId: 'e-security',
        title: 'Security Program Case Study',
        summary: 'Delivered MFA rollout and encryption controls for utility clients.',
        tags: ['security', 'mfa', 'encryption'],
        reqTypes: ['security']
      }
    ]
  );

  assert.equal(rows[0].status, 'draft-ready');
  assert.equal(rows[0].evidenceIds.includes('e-security'), true);
});

test('matchEvidenceForQuery returns relevant evidence IDs', () => {
  const ids = matchEvidenceForQuery(
    'security controls',
    [{ reqType: 'security', statement: 'Need security controls and MFA' }],
    [
      {
        evidenceId: 'e1',
        title: 'Security Certification',
        summary: 'ISO controls and MFA hardening',
        tags: ['security'],
        reqTypes: ['security']
      },
      {
        evidenceId: 'e2',
        title: 'Timeline Plan',
        summary: 'Delivery schedule and milestones',
        tags: ['timeline'],
        reqTypes: ['timeline']
      }
    ],
    3
  );

  assert.equal(ids[0], 'e1');
});
