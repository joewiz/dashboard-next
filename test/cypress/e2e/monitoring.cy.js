/*
 * SPDX LGPL-2.1-or-later
 * Copyright (C) 2001-2026 The eXist-db Authors
 */
/// <reference types="cypress" />

describe('Monitoring Tab', () => {
  beforeEach(() => {
    cy.loginAndVisit('/monitoring');
  });

  it('should load the monitoring page', () => {
    cy.get('.monitoring-page').should('exist');
    cy.get('h1').should('contain', 'Monitoring');
  });

  it('should display memory stats after JMX poll', () => {
    // Wait for first JMX poll (3s interval)
    cy.get('#mem-used', { timeout: 10000 }).should('not.contain', '--');
    cy.get('#mem-max').should('not.contain', '--');
  });

  it('should display broker count', () => {
    cy.get('#brokers-active', { timeout: 10000 }).should('not.contain', '--');
    cy.get('#brokers-total').should('not.contain', '--');
  });

  it('should render the memory chart canvas', () => {
    cy.get('#memory-chart').should('exist');
    cy.get('#memory-chart').should('have.attr', 'height');
  });

  it('should render the CPU chart canvas', () => {
    cy.get('#cpu-chart').should('exist');
  });

  it('should display cache information', () => {
    cy.get('#caches-body', { timeout: 10000 })
      .should('not.contain', 'Loading');
  });

  it('should have a working GC button', () => {
    cy.get('#gc-btn').should('be.visible').click();
    // GC should not cause errors — memory values should still be present
    cy.get('#mem-used', { timeout: 10000 }).should('not.contain', '--');
  });
});
