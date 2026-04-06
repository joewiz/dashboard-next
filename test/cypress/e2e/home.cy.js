/*
 * SPDX LGPL-2.1-or-later
 * Copyright (C) 2001-2026 The eXist-db Authors
 */
/// <reference types="cypress" />

describe('Home Tab', () => {
  beforeEach(() => {
    cy.loginAndVisit('/');
  });

  it('should display version information', () => {
    cy.get('#card-version .stat-value').should('not.be.empty');
    cy.get('#card-version .stat-value').should('contain', 'eXist');
  });

  it('should display Java version', () => {
    cy.get('#card-java .stat-value').should('not.be.empty');
  });

  it('should display platform info', () => {
    cy.get('#card-os .stat-value').should('not.be.empty');
  });

  it('should display uptime', () => {
    cy.get('#uptime-value').should('not.contain', '--');
    cy.get('#uptime-value').should('match', /\d+[dhm]/);
  });

  it('should display memory usage with progress bar', () => {
    cy.get('#card-memory .stat-detail').should('not.contain', '--');
    cy.get('#memory-bar').should('have.attr', 'style').and('not.contain', 'width: 0%');
  });

  it('should display package count', () => {
    cy.get('#packages-value').invoke('text').then((text) => {
      expect(parseInt(text)).to.be.greaterThan(0);
    });
  });
});
