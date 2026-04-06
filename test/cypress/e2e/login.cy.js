/*
 * SPDX LGPL-2.1-or-later
 * Copyright (C) 2001-2026 The eXist-db Authors
 */
/// <reference types="cypress" />

describe('Login', () => {
  it('should show login page for unauthenticated users', () => {
    cy.clearCookies();
    cy.visit('/');
    cy.get('.login-card').should('be.visible');
    cy.get('.login-card h1').should('contain', 'Dashboard');
  });

  it('should reject invalid credentials', () => {
    cy.clearCookies();
    cy.request({
      method: 'POST',
      url: '/exist/apps/dashboard/login',
      form: true,
      body: { user: 'invalid', password: 'wrong' },
      failOnStatusCode: false,
    }).its('status').should('eq', 401);
  });

  it('should accept valid admin credentials', () => {
    cy.request({
      method: 'POST',
      url: '/exist/apps/dashboard/login',
      form: true,
      body: { user: 'admin', password: '', duration: 'P7D' },
    }).then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.have.property('user', 'admin');
      expect(response.body).to.have.property('isAdmin', true);
    });
  });

  it('should report login status via GET /login', () => {
    cy.loginApi();
    cy.request('/exist/apps/dashboard/login').then((response) => {
      expect(response.body).to.have.property('user', 'admin');
    });
  });
});
