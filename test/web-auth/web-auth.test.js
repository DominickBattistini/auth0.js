import proxyquire from 'proxyquire';
import expect from 'expect.js';
import sinon from 'sinon';
import request from 'superagent';
import IdTokenVerifier from 'idtoken-verifier';

import windowHelper from '../../src/helper/window';
import SSODataStorage from '../../src/helper/ssodata';
import Warn from '../../src/helper/warn';

import RequestMock from '../mock/request-mock';

import TransactionManager from '../../src/web-auth/transaction-manager';
import SilentAuthenticationHandler from '../../src/web-auth/silent-authentication-handler';
import CrossOriginAuthentication from '../../src/web-auth/cross-origin-authentication';
import HostedPages from '../../src/web-auth/hosted-pages';
import IframeHandler from '../../src/helper/iframe-handler';

import objectHelper from '../../src/helper/object';
import WebAuth from '../../src/web-auth';

function restoreAndStubStoredTransaction(expectedState, expectedTransaction) {
  TransactionManager.prototype.getStoredTransaction.restore();
  sinon
    .stub(TransactionManager.prototype, 'getStoredTransaction')
    .callsFake(function (state) {
      if (state !== 'ignore-test-state-check') {
        expect(state).to.be(expectedState);
      }
      return expectedTransaction;
    });
}

describe('auth0.WebAuth', function () {
  this.timeout(5000);
  beforeEach(function () {
    sinon
      .stub(TransactionManager.prototype, 'generateTransaction')
      .callsFake(function (appState, state, nonce) {
        return { state: state || 'randomState', nonce: nonce || 'randomNonce' };
      });
    sinon
      .stub(TransactionManager.prototype, 'getStoredTransaction')
      .callsFake(function (state) {
        expect(state).to.be('foo');
        return { state: 'foo' };
      });
  });
  afterEach(function () {
    TransactionManager.prototype.generateTransaction.restore();
    TransactionManager.prototype.getStoredTransaction.restore();
  });

  context('init', function () {
    after(function () {
      delete global.window;
    });

    before(function () {
      global.window = {};
    });

    it('should properly set the overrides', function () {
      var webAuth = new WebAuth({
        domain: 'wptest.auth0.com',
        redirectUri: 'http://page.com/callback',
        clientID: 'gYSNlU4YC4V1YPdqq8zPQcup6rJw1Mbt',
        responseType: 'id_token',
        scope: 'openid name read:blog',
        audience: 'urn:site:demo:blog',
        _sendTelemetry: false,
        _timesToRetryFailedRequests: 2,
        maxAge: 83764,
        overrides: {
          __tenant: 'tenant1',
          __token_issuer: 'issuer1',
          __jwks_uri: 'jwks_uri'
        }
      });

      expect(webAuth.baseOptions.tenant).to.be('tenant1');
      expect(webAuth.baseOptions.token_issuer).to.be('issuer1');
      expect(webAuth.baseOptions.jwksURI).to.be('jwks_uri');
      expect(webAuth.baseOptions.maxAge).to.be(83764);
    });
  });

  context('nonce validation', function () {
    beforeEach(function () {
      global.window = {
        location: {}
      };
      restoreAndStubStoredTransaction('foo', {
        nonce: 'thenonce',
        state: 'foo',
        appState: null
      });
    });
    afterEach(function () {
      delete global.window;
    });

    it('should fail if the nonce is not valid', function (done) {
      sinon
        .stub(SilentAuthenticationHandler.prototype, 'login')
        .callsFake(function (usePostMessage, cb) {
          cb(
            null,
            '#state=foo&access_token=123&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6IlF6RTROMFpCTTBWRFF6RTJSVVUwTnpJMVF6WTFNelE0UVRrMU16QXdNRUk0UkRneE56RTRSZyJ9.eyJpc3MiOiJodHRwczovL3dwdGVzdC5hdXRoMC5jb20vIiwic3ViIjoiYXV0aDB8NTVkNDhjNTdkNWIwYWQwMjIzYzQwOGQ3IiwiYXVkIjoiZ1lTTmxVNFlDNFYxWVBkcXE4elBRY3VwNnJKdzFNYnQiLCJleHAiOjE0ODI5NjkwMzEsImlhdCI6MTQ4MjkzMzAzMSwibm9uY2UiOiJhc2ZkIn0.PPoh-pITcZ8qbF5l5rMZwXiwk5efbESuqZ0IfMUcamB6jdgLwTxq-HpOT_x5q6-sO1PBHchpSo1WHeDYMlRrOFd9bh741sUuBuXdPQZ3Zb0i2sNOAC2RFB1E11mZn7uNvVPGdPTg-Y5xppz30GSXoOJLbeBszfrVDCmPhpHKGGMPL1N6HV-3EEF77L34YNAi2JQ-b70nFK_dnYmmv0cYTGUxtGTHkl64UEDLi3u7bV-kbGky3iOOCzXKzDDY6BBKpCRTc2KlbrkO2A2PuDn27WVv1QCNEFHvJN7HxiDDzXOsaUmjrQ3sfrHhzD7S9BcCRkekRfD9g95SKD5J0Fj8NA'
          );
        });

      var webAuth = new WebAuth({
        domain: 'wptest.auth0.com',
        redirectUri: 'http://page.com/callback',
        clientID: 'gYSNlU4YC4V1YPdqq8zPQcup6rJw1Mbt',
        responseType: 'id_token',
        scope: 'openid name read:blog',
        audience: 'urn:site:demo:blog',
        state: 'foo',
        _sendTelemetry: false
      });

      var options = {
        nonce: '123'
      };

      webAuth.renewAuth(options, function (err, data) {
        expect(err).to.eql({
          error: 'invalid_token',
          errorDescription: `Nonce (nonce) claim value mismatch in the ID token; expected "thenonce", found "asfd"`
        });
        expect(data).to.be(undefined);
        SilentAuthenticationHandler.prototype.login.restore();
        done();
      });
    });
  });

  context(
    'Pass correct postMessageData value to silent-authentication-handler',
    function () {
      before(function () {
        global.window = { origin: 'foobar' };
      });

      after(function () {
        delete global.window;
      });

      afterEach(function () {
        SilentAuthenticationHandler.create.restore();
      });

      it('should pass correct postMessageDataType=false value on to silent authentication handler', function (done) {
        sinon
          .stub(SilentAuthenticationHandler, 'create')
          .callsFake(function (options) {
            expect(options.postMessageDataType).to.be(false);
            done();
            return {
              login: function () {}
            };
          });

        var webAuth = new WebAuth({
          domain: 'wptest.auth0.com',
          redirectUri: 'http://page.com/callback',
          clientID: 'gYSNlU4YC4V1YPdqq8zPQcup6rJw1Mbt',
          responseType: 'id_token',
          scope: 'openid name read:blog',
          audience: 'urn:site:demo:blog',
          _sendTelemetry: false
        });

        var options = {
          nonce: '123',
          state: '456'
        };

        webAuth.renewAuth(options, function (err, data) {});
      });

      it('should pass correct postMessageDataType=<value> on to silent authentication handler', function (done) {
        sinon
          .stub(SilentAuthenticationHandler, 'create')
          .callsFake(function (options) {
            expect(options.postMessageDataType).to.eql(
              'auth0:silent-authentication'
            );
            done();
            return {
              login: function () {}
            };
          });

        var webAuth = new WebAuth({
          domain: 'wptest.auth0.com',
          redirectUri: 'http://page.com/callback',
          clientID: 'gYSNlU4YC4V1YPdqq8zPQcup6rJw1Mbt',
          responseType: 'id_token',
          scope: 'openid name read:blog',
          audience: 'urn:site:demo:blog',
          _sendTelemetry: false
        });

        var options = {
          nonce: '123',
          state: '456',
          postMessageDataType: 'auth0:silent-authentication'
        };

        webAuth.renewAuth(options, function (err, data) {});
      });

      it('should set a default postMessageOrigin to the window origin', function (done) {
        sinon
          .stub(SilentAuthenticationHandler, 'create')
          .callsFake(function (options) {
            expect(options.postMessageOrigin).to.eql('foobar');
            done();
            return {
              login: function () {}
            };
          });

        var webAuth = new WebAuth({
          domain: 'wptest.auth0.com',
          redirectUri: 'http://page.com/callback',
          clientID: 'gYSNlU4YC4V1YPdqq8zPQcup6rJw1Mbt',
          responseType: 'id_token',
          scope: 'openid name read:blog',
          audience: 'urn:site:demo:blog',
          _sendTelemetry: false
        });

        var options = {
          nonce: '123',
          state: '456'
        };

        webAuth.renewAuth(options, function (err, data) {});
      });

      it('should use postMessageOrigin if provided', function (done) {
        var postMessageOrigin = 'foobar1';
        sinon
          .stub(SilentAuthenticationHandler, 'create')
          .callsFake(function (options) {
            expect(options.postMessageOrigin).to.eql(postMessageOrigin);
            done();
            return {
              login: function () {}
            };
          });

        var webAuth = new WebAuth({
          domain: 'wptest.auth0.com',
          redirectUri: 'http://page.com/callback',
          clientID: 'gYSNlU4YC4V1YPdqq8zPQcup6rJw1Mbt',
          responseType: 'id_token',
          scope: 'openid name read:blog',
          audience: 'urn:site:demo:blog',
          _sendTelemetry: false
        });

        var options = {
          nonce: '123',
          state: '456',
          postMessageOrigin: postMessageOrigin
        };

        webAuth.renewAuth(options, function (err, data) {});
      });
    }
  );

  context('parseHash', function () {
    before(function () {
      global.window = {
        location: {
          hash: '#state=foo&access_token=asldkfjahsdlkfjhasd&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6IlF6RTROMFpCTTBWRFF6RTJSVVUwTnpJMVF6WTFNelE0UVRrMU16QXdNRUk0UkRneE56RTRSZyJ9.eyJpc3MiOiJodHRwczovL3dwdGVzdC5hdXRoMC5jb20vIiwic3ViIjoiYXV0aDB8NTVkNDhjNTdkNWIwYWQwMjIzYzQwOGQ3IiwiYXVkIjoiZ1lTTmxVNFlDNFYxWVBkcXE4elBRY3VwNnJKdzFNYnQiLCJleHAiOjE0ODI5NjkwMzEsImlhdCI6MTQ4MjkzMzAzMSwibm9uY2UiOiJhc2ZkIn0.PPoh-pITcZ8qbF5l5rMZwXiwk5efbESuqZ0IfMUcamB6jdgLwTxq-HpOT_x5q6-sO1PBHchpSo1WHeDYMlRrOFd9bh741sUuBuXdPQZ3Zb0i2sNOAC2RFB1E11mZn7uNvVPGdPTg-Y5xppz30GSXoOJLbeBszfrVDCmPhpHKGGMPL1N6HV-3EEF77L34YNAi2JQ-b70nFK_dnYmmv0cYTGUxtGTHkl64UEDLi3u7bV-kbGky3iOOCzXKzDDY6BBKpCRTc2KlbrkO2A2PuDn27WVv1QCNEFHvJN7HxiDDzXOsaUmjrQ3sfrHhzD7S9BcCRkekRfD9g95SKD5J0Fj8NA&token_type=Bearer&refresh_token=kajshdgfkasdjhgfas'
        }
      };
    });

    beforeEach(function () {
      restoreAndStubStoredTransaction('foo', {
        nonce: 'asfd',
        state: 'foo',
        appState: null
      });
      sinon.spy(SSODataStorage.prototype, 'set');

      sinon
        .stub(IdTokenVerifier.prototype, 'validateAccessToken')
        .callsFake(function (at, alg, atHash, cb) {
          cb(null);
        });

      sinon
        .stub(IdTokenVerifier.prototype, 'getRsaVerifier')
        .callsFake(function (iss, kid, cb) {
          cb(null, {
            verify: function () {
              return true;
            }
          });
        });
    });

    afterEach(function () {
      SSODataStorage.prototype.set.restore();

      if (IdTokenVerifier.prototype.validateAccessToken.restore) {
        IdTokenVerifier.prototype.validateAccessToken.restore();
      }

      if (IdTokenVerifier.prototype.getRsaVerifier.restore) {
        IdTokenVerifier.prototype.getRsaVerifier.restore();
      }

      if (WebAuth.prototype.validateToken.restore) {
        WebAuth.prototype.validateToken.restore();
      }
    });

    it('should parse a valid hash without id_token', function (done) {
      var webAuth = new WebAuth({
        domain: 'mdocs.auth0.com',
        redirectUri: 'http://example.com/callback',
        clientID: '0HP71GSd6PuoRYJ3DXKdiXCUUdGmBbup',
        responseType: 'token'
      });

      webAuth.parseHash(
        {
          hash: '#state=foo&access_token=VjubIMBmpgQ2W2&token_type=Bearer&refresh_token=kajshdgfkasdjhgfas'
        },
        function (err, data) {
          expect(data).to.eql({
            accessToken: 'VjubIMBmpgQ2W2',
            idToken: null,
            idTokenPayload: null,
            appState: null,
            refreshToken: 'kajshdgfkasdjhgfas',
            state: 'foo',
            expiresIn: null,
            tokenType: 'Bearer',
            scope: null
          });

          expect(
            TransactionManager.prototype.getStoredTransaction.calledOnce
          ).to.be.ok();

          done();
        }
      ); // eslint-disable-line
    });
    it('should return the id_token payload when there is no access_token', function (done) {
      var webAuth = new WebAuth({
        domain: 'brucke.auth0.com',
        redirectUri: 'http://example.com/callback',
        clientID: 'k5u3o2fiAA8XweXEEX604KCwCjzjtMU6',
        responseType: 'id_token',
        __clock: function () {
          return new Date(1521045300000);
        }
      });

      webAuth.parseHash(
        {
          hash: '#state=foo&token_type=Bearer&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6Ik5FVkJOVU5CT1RneFJrRTVOa1F6UXpjNE9UQkVNRUZGUkRRNU4wUTJRamswUmtRMU1qRkdNUSJ9.eyJuaWNrbmFtZSI6ImpvaG5mb28iLCJuYW1lIjoiam9obmZvb0BnbWFpbC5jb20iLCJwaWN0dXJlIjoiaHR0cHM6Ly9zLmdyYXZhdGFyLmNvbS9hdmF0YXIvMzhmYTAwMjQyM2JkOGM5NDFjNmVkMDU4OGI2MGZmZWQ_cz00ODAmcj1wZyZkPWh0dHBzJTNBJTJGJTJGY2RuLmF1dGgwLmNvbSUyRmF2YXRhcnMlMkZqby5wbmciLCJ1cGRhdGVkX2F0IjoiMjAxOC0wMy0xNFQxNjozNDo1Ni40MjNaIiwiZW1haWwiOiJqb2huZm9vQGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjpmYWxzZSwiaXNzIjoiaHR0cHM6Ly9icnVja2UuYXV0aDAuY29tLyIsInN1YiI6ImF1dGgwfDVhMjA1NGZmNDUxNTc3MTFiZTgxODJmNCIsImF1ZCI6Ims1dTNvMmZpQUE4WHdlWEVFWDYwNEtDd0Nqemp0TVU2IiwiaWF0IjoxNTIxMDQ1Mjk2LCJleHAiOjE1MjEwODEyOTYsImF0X2hhc2giOiJjZHVrb2FVc3dNOWJvX3l6cmdWY3J3Iiwibm9uY2UiOiJsRkNuSTguY3JSVGRIZmRvNWsuek1YZlIzMTg1NmdLeiJ9.U4_F5Zw6xYVoHGiiem1wjz7i9eRaSOrt-L1e6hlu3wmqA-oNuVqf1tEYD9u0z5AbXXbQSr491A3VvUbLKjws13XETcljhaqigZ9q4HBpmzPlrUGmPreBLVQgGOaq5NVAViFTvORxYCMFLlc-SE6QI6xWF0AhFpoW7-hkOcOzXWAXqhkMgwAfjJ9aeOzSBgblmtx4duyNESBRefd3XPQrakWjGIqH3dFdc-lDFbY76eSLYfBi4AH-yim4egzB6LYOC-e2huZcHdmRAmEQaKZ7D7COBiGsgAPVGyjZtqfSQ2CRwNrAbxDwi8BqlLhQePOs6d3hqV-3OPLfdE6dUFh2DQ',
          nonce: 'lFCnI8.crRTdHfdo5k.zMXfR31856gKz'
        },
        function (err, data) {
          if (err) {
            return done(err);
          }

          expect(err).to.be(null);

          expect(data).to.be.eql({
            accessToken: null,
            idToken:
              'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6Ik5FVkJOVU5CT1RneFJrRTVOa1F6UXpjNE9UQkVNRUZGUkRRNU4wUTJRamswUmtRMU1qRkdNUSJ9.eyJuaWNrbmFtZSI6ImpvaG5mb28iLCJuYW1lIjoiam9obmZvb0BnbWFpbC5jb20iLCJwaWN0dXJlIjoiaHR0cHM6Ly9zLmdyYXZhdGFyLmNvbS9hdmF0YXIvMzhmYTAwMjQyM2JkOGM5NDFjNmVkMDU4OGI2MGZmZWQ_cz00ODAmcj1wZyZkPWh0dHBzJTNBJTJGJTJGY2RuLmF1dGgwLmNvbSUyRmF2YXRhcnMlMkZqby5wbmciLCJ1cGRhdGVkX2F0IjoiMjAxOC0wMy0xNFQxNjozNDo1Ni40MjNaIiwiZW1haWwiOiJqb2huZm9vQGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjpmYWxzZSwiaXNzIjoiaHR0cHM6Ly9icnVja2UuYXV0aDAuY29tLyIsInN1YiI6ImF1dGgwfDVhMjA1NGZmNDUxNTc3MTFiZTgxODJmNCIsImF1ZCI6Ims1dTNvMmZpQUE4WHdlWEVFWDYwNEtDd0Nqemp0TVU2IiwiaWF0IjoxNTIxMDQ1Mjk2LCJleHAiOjE1MjEwODEyOTYsImF0X2hhc2giOiJjZHVrb2FVc3dNOWJvX3l6cmdWY3J3Iiwibm9uY2UiOiJsRkNuSTguY3JSVGRIZmRvNWsuek1YZlIzMTg1NmdLeiJ9.U4_F5Zw6xYVoHGiiem1wjz7i9eRaSOrt-L1e6hlu3wmqA-oNuVqf1tEYD9u0z5AbXXbQSr491A3VvUbLKjws13XETcljhaqigZ9q4HBpmzPlrUGmPreBLVQgGOaq5NVAViFTvORxYCMFLlc-SE6QI6xWF0AhFpoW7-hkOcOzXWAXqhkMgwAfjJ9aeOzSBgblmtx4duyNESBRefd3XPQrakWjGIqH3dFdc-lDFbY76eSLYfBi4AH-yim4egzB6LYOC-e2huZcHdmRAmEQaKZ7D7COBiGsgAPVGyjZtqfSQ2CRwNrAbxDwi8BqlLhQePOs6d3hqV-3OPLfdE6dUFh2DQ',
            idTokenPayload: {
              nickname: 'johnfoo',
              name: 'johnfoo@gmail.com',
              picture:
                'https://s.gravatar.com/avatar/38fa002423bd8c941c6ed0588b60ffed?s=480&r=pg&d=https%3A%2F%2Fcdn.auth0.com%2Favatars%2Fjo.png',
              updated_at: '2018-03-14T16:34:56.423Z',
              email: 'johnfoo@gmail.com',
              email_verified: false,
              iss: 'https://brucke.auth0.com/',
              sub: 'auth0|5a2054ff45157711be8182f4',
              aud: 'k5u3o2fiAA8XweXEEX604KCwCjzjtMU6',
              iat: 1521045296,
              exp: 1521081296,
              at_hash: 'cdukoaUswM9bo_yzrgVcrw',
              nonce: 'lFCnI8.crRTdHfdo5k.zMXfR31856gKz'
            },
            appState: null,
            refreshToken: null,
            state: 'foo',
            expiresIn: null,
            tokenType: 'Bearer',
            scope: null
          });

          done();
        }
      ); // eslint-disable-line
    });
    it('should return the id_token payload when there is no payload.at_hash', function (done) {
      restoreAndStubStoredTransaction('foo', {
        state: 'foo',
        appState: null
      });

      var webAuth = new WebAuth({
        domain: 'brucke.auth0.com',
        redirectUri: 'http://example.com/callback',
        clientID: 'BWDP9XS89CJq1w6Nzq7iFOHsTh6ChS2b',
        responseType: 'id_token',
        __clock: () => new Date(1521760350000)
      });

      webAuth.parseHash(
        {
          hash: '#state=foo&token_type=Bearer&access_token=AiU65szv2vyh2xpom8Dqbkdwok4RRZkx&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6Ik5FVkJOVU5CT1RneFJrRTVOa1F6UXpjNE9UQkVNRUZGUkRRNU4wUTJRamswUmtRMU1qRkdNUSJ9.eyJlbWFpbCI6ImpvaG5mb29AZ21haWwuY29tIiwidXNlcm5hbWUiOiJqb2huZm9vIiwiZW1haWxfdmVyaWZpZWQiOmZhbHNlLCJ1c2VyX2lkIjoiYXV0aDB8NWEyMDU0ZmY0NTE1NzcxMWJlODE4MmY0IiwiY2xpZW50SUQiOiJCV0RQOVhTODlDSnExdzZOenE3aUZPSHNUaDZDaFMyYiIsInBpY3R1cmUiOiJodHRwczovL3MuZ3JhdmF0YXIuY29tL2F2YXRhci8zOGZhMDAyNDIzYmQ4Yzk0MWM2ZWQwNTg4YjYwZmZlZD9zPTQ4MCZyPXBnJmQ9aHR0cHMlM0ElMkYlMkZjZG4uYXV0aDAuY29tJTJGYXZhdGFycyUyRmpvLnBuZyIsIm5pY2tuYW1lIjoiam9obmZvbyIsImlkZW50aXRpZXMiOlt7InVzZXJfaWQiOiI1YTIwNTRmZjQ1MTU3NzExYmU4MTgyZjQiLCJwcm92aWRlciI6ImF1dGgwIiwiY29ubmVjdGlvbiI6ImFjbWUiLCJpc1NvY2lhbCI6ZmFsc2V9XSwidXBkYXRlZF9hdCI6IjIwMTgtMDMtMjJUMjM6MTI6MDIuNTc1WiIsImNyZWF0ZWRfYXQiOiIyMDE3LTExLTMwVDE4OjU5OjExLjM2OFoiLCJuYW1lIjoiam9obmZvb0BnbWFpbC5jb20iLCJpc3MiOiJodHRwczovL2JydWNrZS5hdXRoMC5jb20vIiwic3ViIjoiYXV0aDB8NWEyMDU0ZmY0NTE1NzcxMWJlODE4MmY0IiwiYXVkIjoiQldEUDlYUzg5Q0pxMXc2TnpxN2lGT0hzVGg2Q2hTMmIiLCJpYXQiOjE1MjE3NjAzMjIsImV4cCI6MTUyMTc5NjMyMn0.b1afXXSurcVvg71-9w0ABhxLfP5FCdSEPPDYqD8pj2yJXxdVbyK3kdd-caldW330FKwpJlibIbcT4Mz1EpkM_M4P7OyNb1_dJbEgXFoIyqshI4YyIOC0Hn95GPE4uBZMR4GH6O32Scw3KQl9M_pQOZrQySLvU-XNs0Ko99soZbivoc-HTLEXiHDEk9mmnQOBcz44XayMieLP5WQ3c-dDShpFw-Y-8QaaQr1WI1ailh_UdJeJq6SUdn4ItTPUWf7uhmDcWQPJyWh6MyHWBoL4iWh4ZEliVG8Js8J00higeoqP7rsrymb_Hvz5f801mzpro72zfar_tVMp144mH8A65g'
        },
        function (err, data) {
          expect(err).to.be(null);
          expect(data).to.be.eql({
            accessToken: 'AiU65szv2vyh2xpom8Dqbkdwok4RRZkx',
            idToken:
              'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6Ik5FVkJOVU5CT1RneFJrRTVOa1F6UXpjNE9UQkVNRUZGUkRRNU4wUTJRamswUmtRMU1qRkdNUSJ9.eyJlbWFpbCI6ImpvaG5mb29AZ21haWwuY29tIiwidXNlcm5hbWUiOiJqb2huZm9vIiwiZW1haWxfdmVyaWZpZWQiOmZhbHNlLCJ1c2VyX2lkIjoiYXV0aDB8NWEyMDU0ZmY0NTE1NzcxMWJlODE4MmY0IiwiY2xpZW50SUQiOiJCV0RQOVhTODlDSnExdzZOenE3aUZPSHNUaDZDaFMyYiIsInBpY3R1cmUiOiJodHRwczovL3MuZ3JhdmF0YXIuY29tL2F2YXRhci8zOGZhMDAyNDIzYmQ4Yzk0MWM2ZWQwNTg4YjYwZmZlZD9zPTQ4MCZyPXBnJmQ9aHR0cHMlM0ElMkYlMkZjZG4uYXV0aDAuY29tJTJGYXZhdGFycyUyRmpvLnBuZyIsIm5pY2tuYW1lIjoiam9obmZvbyIsImlkZW50aXRpZXMiOlt7InVzZXJfaWQiOiI1YTIwNTRmZjQ1MTU3NzExYmU4MTgyZjQiLCJwcm92aWRlciI6ImF1dGgwIiwiY29ubmVjdGlvbiI6ImFjbWUiLCJpc1NvY2lhbCI6ZmFsc2V9XSwidXBkYXRlZF9hdCI6IjIwMTgtMDMtMjJUMjM6MTI6MDIuNTc1WiIsImNyZWF0ZWRfYXQiOiIyMDE3LTExLTMwVDE4OjU5OjExLjM2OFoiLCJuYW1lIjoiam9obmZvb0BnbWFpbC5jb20iLCJpc3MiOiJodHRwczovL2JydWNrZS5hdXRoMC5jb20vIiwic3ViIjoiYXV0aDB8NWEyMDU0ZmY0NTE1NzcxMWJlODE4MmY0IiwiYXVkIjoiQldEUDlYUzg5Q0pxMXc2TnpxN2lGT0hzVGg2Q2hTMmIiLCJpYXQiOjE1MjE3NjAzMjIsImV4cCI6MTUyMTc5NjMyMn0.b1afXXSurcVvg71-9w0ABhxLfP5FCdSEPPDYqD8pj2yJXxdVbyK3kdd-caldW330FKwpJlibIbcT4Mz1EpkM_M4P7OyNb1_dJbEgXFoIyqshI4YyIOC0Hn95GPE4uBZMR4GH6O32Scw3KQl9M_pQOZrQySLvU-XNs0Ko99soZbivoc-HTLEXiHDEk9mmnQOBcz44XayMieLP5WQ3c-dDShpFw-Y-8QaaQr1WI1ailh_UdJeJq6SUdn4ItTPUWf7uhmDcWQPJyWh6MyHWBoL4iWh4ZEliVG8Js8J00higeoqP7rsrymb_Hvz5f801mzpro72zfar_tVMp144mH8A65g',
            idTokenPayload: {
              email: 'johnfoo@gmail.com',
              username: 'johnfoo',
              email_verified: false,
              user_id: 'auth0|5a2054ff45157711be8182f4',
              clientID: 'BWDP9XS89CJq1w6Nzq7iFOHsTh6ChS2b',
              picture:
                'https://s.gravatar.com/avatar/38fa002423bd8c941c6ed0588b60ffed?s=480&r=pg&d=https%3A%2F%2Fcdn.auth0.com%2Favatars%2Fjo.png',
              nickname: 'johnfoo',
              identities: [
                {
                  user_id: '5a2054ff45157711be8182f4',
                  provider: 'auth0',
                  connection: 'acme',
                  isSocial: false
                }
              ],
              updated_at: '2018-03-22T23:12:02.575Z',
              created_at: '2017-11-30T18:59:11.368Z',
              name: 'johnfoo@gmail.com',
              iss: 'https://brucke.auth0.com/',
              sub: 'auth0|5a2054ff45157711be8182f4',
              aud: 'BWDP9XS89CJq1w6Nzq7iFOHsTh6ChS2b',
              iat: 1521760322,
              exp: 1521796322
            },
            appState: null,
            refreshToken: null,
            state: 'foo',
            expiresIn: null,
            tokenType: 'Bearer',
            scope: null
          });
          done();
        }
      ); // eslint-disable-line
    });
    it('should return the id_token payload when there is a valid access_token', function (done) {
      var webAuth = new WebAuth({
        domain: 'brucke.auth0.com',
        redirectUri: 'http://example.com/callback',
        clientID: 'k5u3o2fiAA8XweXEEX604KCwCjzjtMU6',
        responseType: 'token id_token',
        __clock: () => new Date(1521662700000)
      });

      webAuth.parseHash(
        {
          hash: '#state=foo&token_type=Bearer&access_token=L11oiFDHj3zmZid1AnsEuggXcMfjqe0X&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6Ik5FVkJOVU5CT1RneFJrRTVOa1F6UXpjNE9UQkVNRUZGUkRRNU4wUTJRamswUmtRMU1qRkdNUSJ9.eyJuaWNrbmFtZSI6ImpvaG5mb28iLCJuYW1lIjoiam9obmZvb0BnbWFpbC5jb20iLCJwaWN0dXJlIjoiaHR0cHM6Ly9zLmdyYXZhdGFyLmNvbS9hdmF0YXIvMzhmYTAwMjQyM2JkOGM5NDFjNmVkMDU4OGI2MGZmZWQ_cz00ODAmcj1wZyZkPWh0dHBzJTNBJTJGJTJGY2RuLmF1dGgwLmNvbSUyRmF2YXRhcnMlMkZqby5wbmciLCJ1cGRhdGVkX2F0IjoiMjAxOC0wMy0yMVQyMDowNDo0Mi40OTNaIiwiZW1haWwiOiJqb2huZm9vQGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjpmYWxzZSwiaXNzIjoiaHR0cHM6Ly9icnVja2UuYXV0aDAuY29tLyIsInN1YiI6ImF1dGgwfDVhMjA1NGZmNDUxNTc3MTFiZTgxODJmNCIsImF1ZCI6Ims1dTNvMmZpQUE4WHdlWEVFWDYwNEtDd0Nqemp0TVU2IiwiaWF0IjoxNTIxNjYyNjgyLCJleHAiOjE1MjE2OTg2ODIsImF0X2hhc2giOiJKS2NaM3hTQ2NGVEE5NkxuQ3lJX0FRIiwibm9uY2UiOiJLdlhoc1VIc2VJSEl5emF1X2JVflJHQ2t1RUFDTE5HaiJ9.UbiWFikCkoX-m22mFnXJhKMY8M9BGMDJqZZ5J-iUAQwOmD-33-zX-AjSbD6zL6sOJoKJratJLtLa90tE3sDeokI9c8GE_JonfeF95knVPAx99tD5eCIJabV8HN_K1rfcgI_ed9v8RKQD9_dRkwUMHgXyceWeijnA9k8jG-pe1iXAtnn386G5s6fj-do8SUvC2MFWNmD5VhkW-CyEg_Chui8BoOSM9d7liMZRQkgKA2aGl5t2qqvOu0ZNJwaWoeQ5T0R-h2Yk6Om_alFKyLdZXsZY2LRYQdbk4nEgxY59241HPZGHYOTJN5uLlbcxKyouTyM7Gt4dE76wyRh9kBr47A',
          nonce: 'KvXhsUHseIHIyzau_bU~RGCkuEACLNGj'
        },
        function (err, data) {
          expect(err).to.be(null);
          expect(data).to.be.eql({
            accessToken: 'L11oiFDHj3zmZid1AnsEuggXcMfjqe0X',
            idToken:
              'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6Ik5FVkJOVU5CT1RneFJrRTVOa1F6UXpjNE9UQkVNRUZGUkRRNU4wUTJRamswUmtRMU1qRkdNUSJ9.eyJuaWNrbmFtZSI6ImpvaG5mb28iLCJuYW1lIjoiam9obmZvb0BnbWFpbC5jb20iLCJwaWN0dXJlIjoiaHR0cHM6Ly9zLmdyYXZhdGFyLmNvbS9hdmF0YXIvMzhmYTAwMjQyM2JkOGM5NDFjNmVkMDU4OGI2MGZmZWQ_cz00ODAmcj1wZyZkPWh0dHBzJTNBJTJGJTJGY2RuLmF1dGgwLmNvbSUyRmF2YXRhcnMlMkZqby5wbmciLCJ1cGRhdGVkX2F0IjoiMjAxOC0wMy0yMVQyMDowNDo0Mi40OTNaIiwiZW1haWwiOiJqb2huZm9vQGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjpmYWxzZSwiaXNzIjoiaHR0cHM6Ly9icnVja2UuYXV0aDAuY29tLyIsInN1YiI6ImF1dGgwfDVhMjA1NGZmNDUxNTc3MTFiZTgxODJmNCIsImF1ZCI6Ims1dTNvMmZpQUE4WHdlWEVFWDYwNEtDd0Nqemp0TVU2IiwiaWF0IjoxNTIxNjYyNjgyLCJleHAiOjE1MjE2OTg2ODIsImF0X2hhc2giOiJKS2NaM3hTQ2NGVEE5NkxuQ3lJX0FRIiwibm9uY2UiOiJLdlhoc1VIc2VJSEl5emF1X2JVflJHQ2t1RUFDTE5HaiJ9.UbiWFikCkoX-m22mFnXJhKMY8M9BGMDJqZZ5J-iUAQwOmD-33-zX-AjSbD6zL6sOJoKJratJLtLa90tE3sDeokI9c8GE_JonfeF95knVPAx99tD5eCIJabV8HN_K1rfcgI_ed9v8RKQD9_dRkwUMHgXyceWeijnA9k8jG-pe1iXAtnn386G5s6fj-do8SUvC2MFWNmD5VhkW-CyEg_Chui8BoOSM9d7liMZRQkgKA2aGl5t2qqvOu0ZNJwaWoeQ5T0R-h2Yk6Om_alFKyLdZXsZY2LRYQdbk4nEgxY59241HPZGHYOTJN5uLlbcxKyouTyM7Gt4dE76wyRh9kBr47A',
            idTokenPayload: {
              nickname: 'johnfoo',
              name: 'johnfoo@gmail.com',
              picture:
                'https://s.gravatar.com/avatar/38fa002423bd8c941c6ed0588b60ffed?s=480&r=pg&d=https%3A%2F%2Fcdn.auth0.com%2Favatars%2Fjo.png',
              updated_at: '2018-03-21T20:04:42.493Z',
              email: 'johnfoo@gmail.com',
              email_verified: false,
              iss: 'https://brucke.auth0.com/',
              sub: 'auth0|5a2054ff45157711be8182f4',
              aud: 'k5u3o2fiAA8XweXEEX604KCwCjzjtMU6',
              iat: 1521662682,
              exp: 1521698682,
              at_hash: 'JKcZ3xSCcFTA96LnCyI_AQ',
              nonce: 'KvXhsUHseIHIyzau_bU~RGCkuEACLNGj'
            },
            appState: null,
            refreshToken: null,
            state: 'foo',
            expiresIn: null,
            tokenType: 'Bearer',
            scope: null
          });
          done();
        }
      ); // eslint-disable-line
    });
    context('Organization validation', function () {
      beforeEach(function () {
        restoreAndStubStoredTransaction('foo', {
          nonce: 'asfd',
          state: 'foo',
          appState: null,
          organization: 'org_123'
        });
      });

      afterEach(function () {
        if (IdTokenVerifier.prototype.verify.restore) {
          IdTokenVerifier.prototype.verify.restore();
        }
      });

      it('should validate the organization id', function (done) {
        sinon
          .stub(IdTokenVerifier.prototype, 'verify')
          .callsFake(function (_, __, cb) {
            cb(null, {
              org_id: 'org_123'
            });
          });

        var webAuth = new WebAuth({
          domain: 'brucke.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: 'k5u3o2fiAA8XweXEEX604KCwCjzjtMU6',
          responseType: 'id_token',
          __clock: function () {
            return new Date(1521045300000);
          },
          organization: 'org_123'
        });

        webAuth.parseHash(
          {
            hash: '#state=foo&token_type=Bearer&id_token=token',
            nonce: 'lFCnI8.crRTdHfdo5k.zMXfR31856gKz'
          },
          function (err, data) {
            if (err) {
              return done(err);
            }

            expect(err).to.be(null);
            expect(data.idTokenPayload.org_id).to.eql('org_123');

            done();
          }
        ); // eslint-disable-line
      });

      it('should validate the organization name', function (done) {
        sinon
          .stub(IdTokenVerifier.prototype, 'verify')
          .callsFake(function (_, __, cb) {
            cb(null, {
              org_name: 'organization-a'
            });
          });

        var webAuth = new WebAuth({
          domain: 'brucke.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: 'k5u3o2fiAA8XweXEEX604KCwCjzjtMU6',
          responseType: 'id_token',
          __clock: function () {
            return new Date(1521045300000);
          }
        });

        restoreAndStubStoredTransaction('foo', {
          nonce: 'asfd',
          state: 'foo',
          appState: null,
          organization: 'organization-A'
        });

        webAuth.parseHash(
          {
            hash: '#state=foo&token_type=Bearer&id_token=token',
            nonce: 'lFCnI8.crRTdHfdo5k.zMXfR31856gKz'
          },
          function (err, data) {
            if (err) {
              return done(err);
            }

            expect(err).to.be(null);
            expect(data.idTokenPayload.org_name).to.eql('organization-a');

            done();
          }
        ); // eslint-disable-line
      });

      it('should fail if the org_id claim is not present', function (done) {
        sinon
          .stub(IdTokenVerifier.prototype, 'verify')
          .callsFake(function (_, __, cb) {
            cb(null, {
              org_name: 'organization123'
            });
          });

        var webAuth = new WebAuth({
          domain: 'brucke.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: 'k5u3o2fiAA8XweXEEX604KCwCjzjtMU6',
          responseType: 'id_token',
          __clock: function () {
            return new Date(1521045300000);
          },
          organization: 'org_123'
        });

        webAuth.parseHash(
          {
            hash: '#state=foo&token_type=Bearer&id_token=token',
            nonce: 'lFCnI8.crRTdHfdo5k.zMXfR31856gKz'
          },
          function (err, data) {
            expect(err).not.to.be(null);
            expect(err.errorDescription).to.eql(
              'Organization Id (org_id) claim must be a string present in the ID token'
            );

            done();
          }
        ); // eslint-disable-line
      });

      it('should fail if the org_name claim is not present', function (done) {
        sinon
          .stub(IdTokenVerifier.prototype, 'verify')
          .callsFake(function (_, __, cb) {
            cb(null, {
              org_id: 'org_123'
            });
          });

        var webAuth = new WebAuth({
          domain: 'brucke.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: 'k5u3o2fiAA8XweXEEX604KCwCjzjtMU6',
          responseType: 'id_token',
          __clock: function () {
            return new Date(1521045300000);
          }
        });

        restoreAndStubStoredTransaction('foo', {
          nonce: 'asfd',
          state: 'foo',
          appState: null,
          organization: 'organization123'
        });

        webAuth.parseHash(
          {
            hash: '#state=foo&token_type=Bearer&id_token=token',
            nonce: 'lFCnI8.crRTdHfdo5k.zMXfR31856gKz'
          },
          function (err, data) {
            expect(err).not.to.be(null);
            expect(err.errorDescription).to.eql(
              'Organization Name (org_name) claim must be a string present in the ID token'
            );

            done();
          }
        ); // eslint-disable-line
      });

      it('should fail if the org_id claim is different from the transaction', function (done) {
        sinon
          .stub(IdTokenVerifier.prototype, 'verify')
          .callsFake(function (_, __, cb) {
            cb(null, {
              org_id: 'org_456'
            });
          });

        var webAuth = new WebAuth({
          domain: 'brucke.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: 'k5u3o2fiAA8XweXEEX604KCwCjzjtMU6',
          responseType: 'id_token',
          __clock: function () {
            return new Date(1521045300000);
          },
          organization: 'org_123'
        });

        webAuth.parseHash(
          {
            hash: '#state=foo&token_type=Bearer&id_token=token',
            nonce: 'lFCnI8.crRTdHfdo5k.zMXfR31856gKz'
          },
          function (err, data) {
            expect(err).not.to.be(null);

            expect(err.errorDescription).to.eql(
              `Organization Id (org_id) claim value mismatch in the ID token; expected "org_123", found "org_456"`
            );

            done();
          }
        ); // eslint-disable-line
      });

      it('should fail if the org_name claim is different from the transaction', function (done) {
        sinon
          .stub(IdTokenVerifier.prototype, 'verify')
          .callsFake(function (_, __, cb) {
            cb(null, {
              org_name: 'organization456'
            });
          });

        var webAuth = new WebAuth({
          domain: 'brucke.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: 'k5u3o2fiAA8XweXEEX604KCwCjzjtMU6',
          responseType: 'id_token',
          __clock: function () {
            return new Date(1521045300000);
          }
        });

        restoreAndStubStoredTransaction('foo', {
          nonce: 'asfd',
          state: 'foo',
          appState: null,
          organization: 'organization123'
        });

        webAuth.parseHash(
          {
            hash: '#state=foo&token_type=Bearer&id_token=token',
            nonce: 'lFCnI8.crRTdHfdo5k.zMXfR31856gKz'
          },
          function (err, data) {
            expect(err).not.to.be(null);

            expect(err.errorDescription).to.eql(
              `Organization Name (org_name) claim value mismatch in the ID token; expected "organization123", found "organization456"`
            );

            done();
          }
        ); // eslint-disable-line
      });
    });

    it('should validate an access_token when available', function (done) {
      var webAuth = new WebAuth({
        domain: 'brucke.auth0.com',
        redirectUri: 'http://example.com/callback',
        clientID: 'k5u3o2fiAA8XweXEEX604KCwCjzjtMU6',
        responseType: 'token id_token',
        __clock: () => new Date(1521045300000)
      });
      IdTokenVerifier.prototype.validateAccessToken.restore();

      webAuth.parseHash(
        {
          hash: '#state=foo&token_type=Bearer&access_token=YTvJcYrrZYHUXLZK5leLnfmD5ZIA_EA&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6Ik5FVkJOVU5CT1RneFJrRTVOa1F6UXpjNE9UQkVNRUZGUkRRNU4wUTJRamswUmtRMU1qRkdNUSJ9.eyJuaWNrbmFtZSI6ImpvaG5mb28iLCJuYW1lIjoiam9obmZvb0BnbWFpbC5jb20iLCJwaWN0dXJlIjoiaHR0cHM6Ly9zLmdyYXZhdGFyLmNvbS9hdmF0YXIvMzhmYTAwMjQyM2JkOGM5NDFjNmVkMDU4OGI2MGZmZWQ_cz00ODAmcj1wZyZkPWh0dHBzJTNBJTJGJTJGY2RuLmF1dGgwLmNvbSUyRmF2YXRhcnMlMkZqby5wbmciLCJ1cGRhdGVkX2F0IjoiMjAxOC0wMy0xNFQxNjozNDo1Ni40MjNaIiwiZW1haWwiOiJqb2huZm9vQGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjpmYWxzZSwiaXNzIjoiaHR0cHM6Ly9icnVja2UuYXV0aDAuY29tLyIsInN1YiI6ImF1dGgwfDVhMjA1NGZmNDUxNTc3MTFiZTgxODJmNCIsImF1ZCI6Ims1dTNvMmZpQUE4WHdlWEVFWDYwNEtDd0Nqemp0TVU2IiwiaWF0IjoxNTIxMDQ1Mjk2LCJleHAiOjE1MjEwODEyOTYsImF0X2hhc2giOiJjZHVrb2FVc3dNOWJvX3l6cmdWY3J3Iiwibm9uY2UiOiJsRkNuSTguY3JSVGRIZmRvNWsuek1YZlIzMTg1NmdLeiJ9.U4_F5Zw6xYVoHGiiem1wjz7i9eRaSOrt-L1e6hlu3wmqA-oNuVqf1tEYD9u0z5AbXXbQSr491A3VvUbLKjws13XETcljhaqigZ9q4HBpmzPlrUGmPreBLVQgGOaq5NVAViFTvORxYCMFLlc-SE6QI6xWF0AhFpoW7-hkOcOzXWAXqhkMgwAfjJ9aeOzSBgblmtx4duyNESBRefd3XPQrakWjGIqH3dFdc-lDFbY76eSLYfBi4AH-yim4egzB6LYOC-e2huZcHdmRAmEQaKZ7D7COBiGsgAPVGyjZtqfSQ2CRwNrAbxDwi8BqlLhQePOs6d3hqV-3OPLfdE6dUFh2DQ',
          nonce: 'lFCnI8.crRTdHfdo5k.zMXfR31856gKz'
        },
        function (err, data) {
          expect(err).to.be.eql({
            error: 'invalid_token',
            errorDescription: 'Invalid access_token'
          });
          done();
        }
      ); // eslint-disable-line
    });

    context('when there is a transaction', function () {
      it('should return transaction.appState', function (done) {
        var webAuth = new WebAuth({
          domain: 'mdocs.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: '0HP71GSd6PuoRYJ3DXKdiXCUUdGmBbup',
          responseType: 'token'
        });
        TransactionManager.prototype.getStoredTransaction.restore();
        sinon
          .stub(TransactionManager.prototype, 'getStoredTransaction')
          .callsFake(function () {
            return {
              nonce: 'asfd',
              appState: 'the-app-state',
              state: 'foo'
            };
          });

        webAuth.parseHash(
          {
            hash: '#state=foo&access_token=VjubIMBmpgQ2W2&token_type=Bearer&refresh_token=kajshdgfkasdjhgfas'
          },
          function (err, data) {
            expect(data).to.eql({
              accessToken: 'VjubIMBmpgQ2W2',
              idToken: null,
              idTokenPayload: null,
              appState: 'the-app-state',
              refreshToken: 'kajshdgfkasdjhgfas',
              state: 'foo',
              expiresIn: null,
              tokenType: 'Bearer',
              scope: null
            });

            expect(
              TransactionManager.prototype.getStoredTransaction.calledOnce
            ).to.be.ok();

            done();
          }
        ); // eslint-disable-line
      });
      context('when there is a transaction.lastUsedConnection', function () {
        beforeEach(function () {
          this.webAuth = new WebAuth({
            domain: 'brucke.auth0.com',
            redirectUri: 'http://example.com/callback',
            clientID: 'k5u3o2fiAA8XweXEEX604KCwCjzjtMU6',
            responseType: 'token id_token',
            __clock: () => new Date(1511551800000)
          });
          TransactionManager.prototype.getStoredTransaction.restore();
          sinon
            .stub(TransactionManager.prototype, 'getStoredTransaction')
            .callsFake(function () {
              return {
                lastUsedConnection: 'lastUsedConnection',
                state: 'foo'
              };
            });
        });
        it('sets ssodata with a connection and without a sub when there is no payload', function (done) {
          var webAuth = new WebAuth({
            domain: 'brucke.auth0.com',
            redirectUri: 'http://example.com/callback',
            clientID: 'k5u3o2fiAA8XweXEEX604KCwCjzjtMU6',
            responseType: 'token'
          });

          webAuth.parseHash(
            {
              hash: '#state=foo&access_token=VjubIMBmpgQ2W2&token_type=Bearer&refresh_token=kajshdgfkasdjhgfas'
            },
            function (err) {
              if (err) return done(err);

              expect(SSODataStorage.prototype.set.calledOnce).to.be.ok();
              expect(SSODataStorage.prototype.set.firstCall.args).to.be.eql([
                'lastUsedConnection',
                undefined
              ]);
              expect(
                TransactionManager.prototype.getStoredTransaction.calledOnce
              ).to.be.ok();
              done();
            }
          ); // eslint-disable-line
        });
        it('sets ssodata with a connection and a sub when there is a payload', function (done) {
          this.webAuth.parseHash(
            {
              hash: '#state=foo&access_token=VjubIMBmpgQ2W2&token_type=Bearer&refresh_token=kajshdgfkasdjhgfas&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6Ik5FVkJOVU5CT1RneFJrRTVOa1F6UXpjNE9UQkVNRUZGUkRRNU4wUTJRamswUmtRMU1qRkdNUSJ9.eyJpc3MiOiJodHRwczovL2JydWNrZS5hdXRoMC5jb20vIiwic3ViIjoiYXV0aDB8NTlmYmUxMTkzNzAzOWIyNjNhOGIyOWEyIiwiYXVkIjoiazV1M28yZmlBQThYd2VYRUVYNjA0S0N3Q2p6anRNVTYiLCJpYXQiOjE1MTE1NTE3ODMsImV4cCI6MTUxMTU4Nzc4MywiYXRfaGFzaCI6IkxGTDMxMlRXWDFGc1VNay00R2gxYWciLCJub25jZSI6IndFT2U3LUxDOG5sMUF1SHA3bnVjRl81TE1WUFZrTUJZIn0.fUJhEIPded3aO4iDrbniwGnAEZHX66Mjl7yCgIxSSCXlgrHlOATvbMi7XGQXNfPjGCivySoalMCS3MikvMGBFPFguChyJZ3myswT6US33hZSTycUYODvWSz8j7PeEpJrHdF4nAO4NvbC4JjogG92Xg2zx0KCZtoLK9datZiWEWHVUEVEXZCwceyowxQ4J5dqDzzLm9_V9qBsUYJtINqMM6jhHazk7OQUFZlE35R3l-Lps2oofqxZf11X7g0bgxo5ykSSr_KDvj9Hx0flk_u-eTTD2XVGMWe1TreJm1KMMuD01PicU1JGsJRA0hqE6Fd943OAEAIM6feMximK22rrHg',
              nonce: 'wEOe7-LC8nl1AuHp7nucF_5LMVPVkMBY'
            },
            function (err) {
              if (err) return done(err);

              expect(SSODataStorage.prototype.set.calledOnce).to.be.ok();
              expect(SSODataStorage.prototype.set.firstCall.args).to.be.eql([
                'lastUsedConnection',
                'auth0|59fbe11937039b263a8b29a2'
              ]);
              expect(
                TransactionManager.prototype.getStoredTransaction.calledOnce
              ).to.be.ok();

              done();
            }
          ); // eslint-disable-line
        });
      });
    });

    context('with RS256 id_token', function () {
      it('should parse a valid hash', function (done) {
        var webAuth = new WebAuth({
          domain: 'wptest.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: 'gYSNlU4YC4V1YPdqq8zPQcup6rJw1Mbt',
          responseType: 'token',
          __clock: () => new Date(1482933050000)
        });

        webAuth.parseHash(
          {
            nonce: 'asfd',
            hash: '#state=foo&access_token=VjubIMBmpgQ2W2&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6IlF6RTROMFpCTTBWRFF6RTJSVVUwTnpJMVF6WTFNelE0UVRrMU16QXdNRUk0UkRneE56RTRSZyJ9.eyJpc3MiOiJodHRwczovL3dwdGVzdC5hdXRoMC5jb20vIiwic3ViIjoiYXV0aDB8NTVkNDhjNTdkNWIwYWQwMjIzYzQwOGQ3IiwiYXVkIjoiZ1lTTmxVNFlDNFYxWVBkcXE4elBRY3VwNnJKdzFNYnQiLCJleHAiOjE0ODI5NjkwMzEsImlhdCI6MTQ4MjkzMzAzMSwibm9uY2UiOiJhc2ZkIn0.PPoh-pITcZ8qbF5l5rMZwXiwk5efbESuqZ0IfMUcamB6jdgLwTxq-HpOT_x5q6-sO1PBHchpSo1WHeDYMlRrOFd9bh741sUuBuXdPQZ3Zb0i2sNOAC2RFB1E11mZn7uNvVPGdPTg-Y5xppz30GSXoOJLbeBszfrVDCmPhpHKGGMPL1N6HV-3EEF77L34YNAi2JQ-b70nFK_dnYmmv0cYTGUxtGTHkl64UEDLi3u7bV-kbGky3iOOCzXKzDDY6BBKpCRTc2KlbrkO2A2PuDn27WVv1QCNEFHvJN7HxiDDzXOsaUmjrQ3sfrHhzD7S9BcCRkekRfD9g95SKD5J0Fj8NA&token_type=Bearer&refresh_token=kajshdgfkasdjhgfas&scope=foo'
          },
          function (err, data) {
            expect(err).to.be(null);
            expect(data).to.eql({
              accessToken: 'VjubIMBmpgQ2W2',
              idToken:
                'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6IlF6RTROMFpCTTBWRFF6RTJSVVUwTnpJMVF6WTFNelE0UVRrMU16QXdNRUk0UkRneE56RTRSZyJ9.eyJpc3MiOiJodHRwczovL3dwdGVzdC5hdXRoMC5jb20vIiwic3ViIjoiYXV0aDB8NTVkNDhjNTdkNWIwYWQwMjIzYzQwOGQ3IiwiYXVkIjoiZ1lTTmxVNFlDNFYxWVBkcXE4elBRY3VwNnJKdzFNYnQiLCJleHAiOjE0ODI5NjkwMzEsImlhdCI6MTQ4MjkzMzAzMSwibm9uY2UiOiJhc2ZkIn0.PPoh-pITcZ8qbF5l5rMZwXiwk5efbESuqZ0IfMUcamB6jdgLwTxq-HpOT_x5q6-sO1PBHchpSo1WHeDYMlRrOFd9bh741sUuBuXdPQZ3Zb0i2sNOAC2RFB1E11mZn7uNvVPGdPTg-Y5xppz30GSXoOJLbeBszfrVDCmPhpHKGGMPL1N6HV-3EEF77L34YNAi2JQ-b70nFK_dnYmmv0cYTGUxtGTHkl64UEDLi3u7bV-kbGky3iOOCzXKzDDY6BBKpCRTc2KlbrkO2A2PuDn27WVv1QCNEFHvJN7HxiDDzXOsaUmjrQ3sfrHhzD7S9BcCRkekRfD9g95SKD5J0Fj8NA',
              idTokenPayload: {
                iss: 'https://wptest.auth0.com/',
                sub: 'auth0|55d48c57d5b0ad0223c408d7',
                aud: 'gYSNlU4YC4V1YPdqq8zPQcup6rJw1Mbt',
                exp: 1482969031,
                iat: 1482933031,
                nonce: 'asfd'
              },
              appState: null,
              refreshToken: 'kajshdgfkasdjhgfas',
              state: 'foo',
              expiresIn: null,
              tokenType: 'Bearer',
              scope: 'foo'
            });

            expect(
              TransactionManager.prototype.getStoredTransaction.calledOnce
            ).to.be.ok();

            done();
          }
        ); // eslint-disable-line
      });

      it('should parse a valid hash from the location.hash', function (done) {
        var webAuth = new WebAuth({
          domain: 'wptest.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: 'gYSNlU4YC4V1YPdqq8zPQcup6rJw1Mbt',
          responseType: 'token',
          __clock: () => new Date(1482933050000)
        });

        webAuth.parseHash({ nonce: 'asfd' }, function (err, data) {
          expect(err).to.be(null);
          expect(data).to.eql({
            accessToken: 'asldkfjahsdlkfjhasd',
            idToken:
              'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6IlF6RTROMFpCTTBWRFF6RTJSVVUwTnpJMVF6WTFNelE0UVRrMU16QXdNRUk0UkRneE56RTRSZyJ9.eyJpc3MiOiJodHRwczovL3dwdGVzdC5hdXRoMC5jb20vIiwic3ViIjoiYXV0aDB8NTVkNDhjNTdkNWIwYWQwMjIzYzQwOGQ3IiwiYXVkIjoiZ1lTTmxVNFlDNFYxWVBkcXE4elBRY3VwNnJKdzFNYnQiLCJleHAiOjE0ODI5NjkwMzEsImlhdCI6MTQ4MjkzMzAzMSwibm9uY2UiOiJhc2ZkIn0.PPoh-pITcZ8qbF5l5rMZwXiwk5efbESuqZ0IfMUcamB6jdgLwTxq-HpOT_x5q6-sO1PBHchpSo1WHeDYMlRrOFd9bh741sUuBuXdPQZ3Zb0i2sNOAC2RFB1E11mZn7uNvVPGdPTg-Y5xppz30GSXoOJLbeBszfrVDCmPhpHKGGMPL1N6HV-3EEF77L34YNAi2JQ-b70nFK_dnYmmv0cYTGUxtGTHkl64UEDLi3u7bV-kbGky3iOOCzXKzDDY6BBKpCRTc2KlbrkO2A2PuDn27WVv1QCNEFHvJN7HxiDDzXOsaUmjrQ3sfrHhzD7S9BcCRkekRfD9g95SKD5J0Fj8NA',
            idTokenPayload: {
              iss: 'https://wptest.auth0.com/',
              sub: 'auth0|55d48c57d5b0ad0223c408d7',
              aud: 'gYSNlU4YC4V1YPdqq8zPQcup6rJw1Mbt',
              exp: 1482969031,
              iat: 1482933031,
              nonce: 'asfd'
            },
            appState: null,
            refreshToken: 'kajshdgfkasdjhgfas',
            state: 'foo',
            expiresIn: null,
            tokenType: 'Bearer',
            scope: null
          });

          expect(
            TransactionManager.prototype.getStoredTransaction.calledOnce
          ).to.be.ok();

          done();
        });
      });

      it('should parse a valid hash from the location.hash even if transaction is null but state & nonce passed as parameters', function (done) {
        var webAuth = new WebAuth({
          domain: 'wptest.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: 'gYSNlU4YC4V1YPdqq8zPQcup6rJw1Mbt',
          responseType: 'token',
          __clock: () => new Date(1482933050000)
        });

        TransactionManager.prototype.getStoredTransaction.restore();

        sinon
          .stub(TransactionManager.prototype, 'getStoredTransaction')
          .callsFake(function () {
            return null;
          });

        webAuth.parseHash(
          {
            nonce: 'asfd',
            state: '123',
            hash: '#state=123&access_token=asldkfjahsdlkfjhasd&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6IlF6RTROMFpCTTBWRFF6RTJSVVUwTnpJMVF6WTFNelE0UVRrMU16QXdNRUk0UkRneE56RTRSZyJ9.eyJpc3MiOiJodHRwczovL3dwdGVzdC5hdXRoMC5jb20vIiwic3ViIjoiYXV0aDB8NTVkNDhjNTdkNWIwYWQwMjIzYzQwOGQ3IiwiYXVkIjoiZ1lTTmxVNFlDNFYxWVBkcXE4elBRY3VwNnJKdzFNYnQiLCJleHAiOjE0ODI5NjkwMzEsImlhdCI6MTQ4MjkzMzAzMSwibm9uY2UiOiJhc2ZkIn0.PPoh-pITcZ8qbF5l5rMZwXiwk5efbESuqZ0IfMUcamB6jdgLwTxq-HpOT_x5q6-sO1PBHchpSo1WHeDYMlRrOFd9bh741sUuBuXdPQZ3Zb0i2sNOAC2RFB1E11mZn7uNvVPGdPTg-Y5xppz30GSXoOJLbeBszfrVDCmPhpHKGGMPL1N6HV-3EEF77L34YNAi2JQ-b70nFK_dnYmmv0cYTGUxtGTHkl64UEDLi3u7bV-kbGky3iOOCzXKzDDY6BBKpCRTc2KlbrkO2A2PuDn27WVv1QCNEFHvJN7HxiDDzXOsaUmjrQ3sfrHhzD7S9BcCRkekRfD9g95SKD5J0Fj8NA&token_type=Bearer&refresh_token=kajshdgfkasdjhgfas'
          },
          function (err, data) {
            expect(err).to.be(null);
            expect(data).to.eql({
              accessToken: 'asldkfjahsdlkfjhasd',
              idToken:
                'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6IlF6RTROMFpCTTBWRFF6RTJSVVUwTnpJMVF6WTFNelE0UVRrMU16QXdNRUk0UkRneE56RTRSZyJ9.eyJpc3MiOiJodHRwczovL3dwdGVzdC5hdXRoMC5jb20vIiwic3ViIjoiYXV0aDB8NTVkNDhjNTdkNWIwYWQwMjIzYzQwOGQ3IiwiYXVkIjoiZ1lTTmxVNFlDNFYxWVBkcXE4elBRY3VwNnJKdzFNYnQiLCJleHAiOjE0ODI5NjkwMzEsImlhdCI6MTQ4MjkzMzAzMSwibm9uY2UiOiJhc2ZkIn0.PPoh-pITcZ8qbF5l5rMZwXiwk5efbESuqZ0IfMUcamB6jdgLwTxq-HpOT_x5q6-sO1PBHchpSo1WHeDYMlRrOFd9bh741sUuBuXdPQZ3Zb0i2sNOAC2RFB1E11mZn7uNvVPGdPTg-Y5xppz30GSXoOJLbeBszfrVDCmPhpHKGGMPL1N6HV-3EEF77L34YNAi2JQ-b70nFK_dnYmmv0cYTGUxtGTHkl64UEDLi3u7bV-kbGky3iOOCzXKzDDY6BBKpCRTc2KlbrkO2A2PuDn27WVv1QCNEFHvJN7HxiDDzXOsaUmjrQ3sfrHhzD7S9BcCRkekRfD9g95SKD5J0Fj8NA',
              idTokenPayload: {
                iss: 'https://wptest.auth0.com/',
                sub: 'auth0|55d48c57d5b0ad0223c408d7',
                aud: 'gYSNlU4YC4V1YPdqq8zPQcup6rJw1Mbt',
                exp: 1482969031,
                iat: 1482933031,
                nonce: 'asfd'
              },
              appState: '123',
              refreshToken: 'kajshdgfkasdjhgfas',
              state: '123',
              expiresIn: null,
              tokenType: 'Bearer',
              scope: null
            });

            expect(
              TransactionManager.prototype.getStoredTransaction.calledOnce
            ).to.be.ok();

            done();
          }
        );
      });

      it('should bypass state checking when options.__enableIdPInitiatedLogin is set to true and there is no state in the hash and in the transaction', function (done) {
        var webAuth = new WebAuth({
          domain: 'wptest.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: 'gYSNlU4YC4V1YPdqq8zPQcup6rJw1Mbt',
          responseType: 'token',
          __clock: () => new Date(1482933050000)
        });
        TransactionManager.prototype.getStoredTransaction.restore();
        sinon
          .stub(TransactionManager.prototype, 'getStoredTransaction')
          .callsFake(function () {
            return null;
          });

        webAuth.parseHash(
          {
            nonce: 'asfd',
            hash: '#access_token=asldkfjahsdlkfjhasd&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6IlF6RTROMFpCTTBWRFF6RTJSVVUwTnpJMVF6WTFNelE0UVRrMU16QXdNRUk0UkRneE56RTRSZyJ9.eyJpc3MiOiJodHRwczovL3dwdGVzdC5hdXRoMC5jb20vIiwic3ViIjoiYXV0aDB8NTVkNDhjNTdkNWIwYWQwMjIzYzQwOGQ3IiwiYXVkIjoiZ1lTTmxVNFlDNFYxWVBkcXE4elBRY3VwNnJKdzFNYnQiLCJleHAiOjE0ODI5NjkwMzEsImlhdCI6MTQ4MjkzMzAzMSwibm9uY2UiOiJhc2ZkIn0.PPoh-pITcZ8qbF5l5rMZwXiwk5efbESuqZ0IfMUcamB6jdgLwTxq-HpOT_x5q6-sO1PBHchpSo1WHeDYMlRrOFd9bh741sUuBuXdPQZ3Zb0i2sNOAC2RFB1E11mZn7uNvVPGdPTg-Y5xppz30GSXoOJLbeBszfrVDCmPhpHKGGMPL1N6HV-3EEF77L34YNAi2JQ-b70nFK_dnYmmv0cYTGUxtGTHkl64UEDLi3u7bV-kbGky3iOOCzXKzDDY6BBKpCRTc2KlbrkO2A2PuDn27WVv1QCNEFHvJN7HxiDDzXOsaUmjrQ3sfrHhzD7S9BcCRkekRfD9g95SKD5J0Fj8NA&token_type=Bearer&refresh_token=kajshdgfkasdjhgfas',
            __enableIdPInitiatedLogin: true
          },
          function (err, data) {
            expect(err).to.be(null);
            expect(data).to.eql({
              accessToken: 'asldkfjahsdlkfjhasd',
              idToken:
                'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6IlF6RTROMFpCTTBWRFF6RTJSVVUwTnpJMVF6WTFNelE0UVRrMU16QXdNRUk0UkRneE56RTRSZyJ9.eyJpc3MiOiJodHRwczovL3dwdGVzdC5hdXRoMC5jb20vIiwic3ViIjoiYXV0aDB8NTVkNDhjNTdkNWIwYWQwMjIzYzQwOGQ3IiwiYXVkIjoiZ1lTTmxVNFlDNFYxWVBkcXE4elBRY3VwNnJKdzFNYnQiLCJleHAiOjE0ODI5NjkwMzEsImlhdCI6MTQ4MjkzMzAzMSwibm9uY2UiOiJhc2ZkIn0.PPoh-pITcZ8qbF5l5rMZwXiwk5efbESuqZ0IfMUcamB6jdgLwTxq-HpOT_x5q6-sO1PBHchpSo1WHeDYMlRrOFd9bh741sUuBuXdPQZ3Zb0i2sNOAC2RFB1E11mZn7uNvVPGdPTg-Y5xppz30GSXoOJLbeBszfrVDCmPhpHKGGMPL1N6HV-3EEF77L34YNAi2JQ-b70nFK_dnYmmv0cYTGUxtGTHkl64UEDLi3u7bV-kbGky3iOOCzXKzDDY6BBKpCRTc2KlbrkO2A2PuDn27WVv1QCNEFHvJN7HxiDDzXOsaUmjrQ3sfrHhzD7S9BcCRkekRfD9g95SKD5J0Fj8NA',
              idTokenPayload: {
                iss: 'https://wptest.auth0.com/',
                sub: 'auth0|55d48c57d5b0ad0223c408d7',
                aud: 'gYSNlU4YC4V1YPdqq8zPQcup6rJw1Mbt',
                exp: 1482969031,
                iat: 1482933031,
                nonce: 'asfd'
              },
              appState: null,
              refreshToken: 'kajshdgfkasdjhgfas',
              state: null,
              expiresIn: null,
              tokenType: 'Bearer',
              scope: null
            });

            expect(
              TransactionManager.prototype.getStoredTransaction.calledOnce
            ).to.be.ok();

            done();
          }
        );
      });
      it('should bypass state checking when options.__enableImpersonation is set to true and there is no state in the hash and in the transaction', function (done) {
        var webAuth = new WebAuth({
          domain: 'wptest.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: 'gYSNlU4YC4V1YPdqq8zPQcup6rJw1Mbt',
          responseType: 'token',
          __clock: () => new Date(1482933050000)
        });
        TransactionManager.prototype.getStoredTransaction.restore();
        sinon
          .stub(TransactionManager.prototype, 'getStoredTransaction')
          .callsFake(function () {
            return null;
          });

        var data = webAuth.parseHash(
          {
            nonce: 'asfd',
            hash: '#access_token=asldkfjahsdlkfjhasd&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6IlF6RTROMFpCTTBWRFF6RTJSVVUwTnpJMVF6WTFNelE0UVRrMU16QXdNRUk0UkRneE56RTRSZyJ9.eyJpc3MiOiJodHRwczovL3dwdGVzdC5hdXRoMC5jb20vIiwic3ViIjoiYXV0aDB8NTVkNDhjNTdkNWIwYWQwMjIzYzQwOGQ3IiwiYXVkIjoiZ1lTTmxVNFlDNFYxWVBkcXE4elBRY3VwNnJKdzFNYnQiLCJleHAiOjE0ODI5NjkwMzEsImlhdCI6MTQ4MjkzMzAzMSwibm9uY2UiOiJhc2ZkIn0.PPoh-pITcZ8qbF5l5rMZwXiwk5efbESuqZ0IfMUcamB6jdgLwTxq-HpOT_x5q6-sO1PBHchpSo1WHeDYMlRrOFd9bh741sUuBuXdPQZ3Zb0i2sNOAC2RFB1E11mZn7uNvVPGdPTg-Y5xppz30GSXoOJLbeBszfrVDCmPhpHKGGMPL1N6HV-3EEF77L34YNAi2JQ-b70nFK_dnYmmv0cYTGUxtGTHkl64UEDLi3u7bV-kbGky3iOOCzXKzDDY6BBKpCRTc2KlbrkO2A2PuDn27WVv1QCNEFHvJN7HxiDDzXOsaUmjrQ3sfrHhzD7S9BcCRkekRfD9g95SKD5J0Fj8NA&token_type=Bearer&refresh_token=kajshdgfkasdjhgfas',
            __enableImpersonation: true
          },
          function (err, data) {
            expect(err).to.be(null);
            expect(data).to.eql({
              accessToken: 'asldkfjahsdlkfjhasd',
              idToken:
                'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6IlF6RTROMFpCTTBWRFF6RTJSVVUwTnpJMVF6WTFNelE0UVRrMU16QXdNRUk0UkRneE56RTRSZyJ9.eyJpc3MiOiJodHRwczovL3dwdGVzdC5hdXRoMC5jb20vIiwic3ViIjoiYXV0aDB8NTVkNDhjNTdkNWIwYWQwMjIzYzQwOGQ3IiwiYXVkIjoiZ1lTTmxVNFlDNFYxWVBkcXE4elBRY3VwNnJKdzFNYnQiLCJleHAiOjE0ODI5NjkwMzEsImlhdCI6MTQ4MjkzMzAzMSwibm9uY2UiOiJhc2ZkIn0.PPoh-pITcZ8qbF5l5rMZwXiwk5efbESuqZ0IfMUcamB6jdgLwTxq-HpOT_x5q6-sO1PBHchpSo1WHeDYMlRrOFd9bh741sUuBuXdPQZ3Zb0i2sNOAC2RFB1E11mZn7uNvVPGdPTg-Y5xppz30GSXoOJLbeBszfrVDCmPhpHKGGMPL1N6HV-3EEF77L34YNAi2JQ-b70nFK_dnYmmv0cYTGUxtGTHkl64UEDLi3u7bV-kbGky3iOOCzXKzDDY6BBKpCRTc2KlbrkO2A2PuDn27WVv1QCNEFHvJN7HxiDDzXOsaUmjrQ3sfrHhzD7S9BcCRkekRfD9g95SKD5J0Fj8NA',
              idTokenPayload: {
                iss: 'https://wptest.auth0.com/',
                sub: 'auth0|55d48c57d5b0ad0223c408d7',
                aud: 'gYSNlU4YC4V1YPdqq8zPQcup6rJw1Mbt',
                exp: 1482969031,
                iat: 1482933031,
                nonce: 'asfd'
              },
              appState: null,
              refreshToken: 'kajshdgfkasdjhgfas',
              state: null,
              expiresIn: null,
              tokenType: 'Bearer',
              scope: null
            });

            expect(
              TransactionManager.prototype.getStoredTransaction.calledOnce
            ).to.be.ok();

            done();
          }
        );
      });

      it('should fail when there is no state available in the hash', function (done) {
        var webAuth = new WebAuth({
          domain: 'mdocs.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: '0HP71GSd6PuoRYJ3p',
          responseType: 'token'
        });
        TransactionManager.prototype.getStoredTransaction.restore();
        sinon
          .stub(TransactionManager.prototype, 'getStoredTransaction')
          .callsFake(function () {
            return null;
          });

        webAuth.parseHash(
          {
            hash: '#access_token=VjubIMBmpgQ2W2&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6IlF6RTROMFpCTTBWRFF6RTJSVVUwTnpJMVF6WTFNelE0UVRrMU16QXdNRUk0UkRneE56RTRSZyJ9.eyJpc3MiOiJodHRwczovL3dwdGVzdC5hdXRoMC5jb20vIiwic3ViIjoiYXV0aDB8NTVkNDhjNTdkNWIwYWQwMjIzYzQwOGQ3IiwiYXVkIjoiZ1lTTmxVNFlDNFYxWVBkcXE4elBRY3VwNnJKdzFNYnQiLCJleHAiOjE0ODI5NjkwMzEsImlhdCI6MTQ4MjkzMzAzMSwibm9uY2UiOiJhc2ZkIn0.PPoh-pITcZ8qbF5l5rMZwXiwk5efbESuqZ0IfMUcamB6jdgLwTxq-HpOT_x5q6-sO1PBHchpSo1WHeDYMlRrOFd9bh741sUuBuXdPQZ3Zb0i2sNOAC2RFB1E11mZn7uNvVPGdPTg-Y5xppz30GSXoOJLbeBszfrVDCmPhpHKGGMPL1N6HV-3EEF77L34YNAi2JQ-b70nFK_dnYmmv0cYTGUxtGTHkl64UEDLi3u7bV-kbGky3iOOCzXKzDDY6BBKpCRTc2KlbrkO2A2PuDn27WVv1QCNEFHvJN7HxiDDzXOsaUmjrQ3sfrHhzD7S9BcCRkekRfD9g95SKD5J0Fj8NA&token_type=Bearer&refresh_token=kajshdgfkasdjhgfas'
          },
          function (err, data) {
            expect(err).to.eql({
              error: 'invalid_token',
              errorDescription: '`state` does not match.'
            });
            done();
          }
        ); // eslint-disable-line
      });

      it('should fail with an invalid state (null transaction)', function (done) {
        var webAuth = new WebAuth({
          domain: 'mdocs.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: '0HP71GSd6PuoRYJ3p',
          responseType: 'token'
        });
        TransactionManager.prototype.getStoredTransaction.restore();
        sinon
          .stub(TransactionManager.prototype, 'getStoredTransaction')
          .callsFake(function () {
            return null;
          });

        var data = webAuth.parseHash(
          {
            hash: '#state=123&access_token=VjubIMBmpgQ2W2&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6IlF6RTROMFpCTTBWRFF6RTJSVVUwTnpJMVF6WTFNelE0UVRrMU16QXdNRUk0UkRneE56RTRSZyJ9.eyJpc3MiOiJodHRwczovL3dwdGVzdC5hdXRoMC5jb20vIiwic3ViIjoiYXV0aDB8NTVkNDhjNTdkNWIwYWQwMjIzYzQwOGQ3IiwiYXVkIjoiZ1lTTmxVNFlDNFYxWVBkcXE4elBRY3VwNnJKdzFNYnQiLCJleHAiOjE0ODI5NjkwMzEsImlhdCI6MTQ4MjkzMzAzMSwibm9uY2UiOiJhc2ZkIn0.PPoh-pITcZ8qbF5l5rMZwXiwk5efbESuqZ0IfMUcamB6jdgLwTxq-HpOT_x5q6-sO1PBHchpSo1WHeDYMlRrOFd9bh741sUuBuXdPQZ3Zb0i2sNOAC2RFB1E11mZn7uNvVPGdPTg-Y5xppz30GSXoOJLbeBszfrVDCmPhpHKGGMPL1N6HV-3EEF77L34YNAi2JQ-b70nFK_dnYmmv0cYTGUxtGTHkl64UEDLi3u7bV-kbGky3iOOCzXKzDDY6BBKpCRTc2KlbrkO2A2PuDn27WVv1QCNEFHvJN7HxiDDzXOsaUmjrQ3sfrHhzD7S9BcCRkekRfD9g95SKD5J0Fj8NA&token_type=Bearer&refresh_token=kajshdgfkasdjhgfas'
          },
          function (err, data) {
            expect(err).to.eql({
              error: 'invalid_token',
              errorDescription: '`state` does not match.'
            });
            done();
          }
        ); // eslint-disable-line
      });

      it('should fail with an invalid state (available transaction)', function (done) {
        var webAuth = new WebAuth({
          domain: 'mdocs.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: '0HP71GSd6PuoRYJ3p',
          responseType: 'token'
        });
        TransactionManager.prototype.getStoredTransaction.restore();
        sinon
          .stub(TransactionManager.prototype, 'getStoredTransaction')
          .callsFake(function () {
            return {
              state: 'not-123'
            };
          });

        var data = webAuth.parseHash(
          {
            hash: '#state=123&access_token=VjubIMBmpgQ2W2&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6IlF6RTROMFpCTTBWRFF6RTJSVVUwTnpJMVF6WTFNelE0UVRrMU16QXdNRUk0UkRneE56RTRSZyJ9.eyJpc3MiOiJodHRwczovL3dwdGVzdC5hdXRoMC5jb20vIiwic3ViIjoiYXV0aDB8NTVkNDhjNTdkNWIwYWQwMjIzYzQwOGQ3IiwiYXVkIjoiZ1lTTmxVNFlDNFYxWVBkcXE4elBRY3VwNnJKdzFNYnQiLCJleHAiOjE0ODI5NjkwMzEsImlhdCI6MTQ4MjkzMzAzMSwibm9uY2UiOiJhc2ZkIn0.PPoh-pITcZ8qbF5l5rMZwXiwk5efbESuqZ0IfMUcamB6jdgLwTxq-HpOT_x5q6-sO1PBHchpSo1WHeDYMlRrOFd9bh741sUuBuXdPQZ3Zb0i2sNOAC2RFB1E11mZn7uNvVPGdPTg-Y5xppz30GSXoOJLbeBszfrVDCmPhpHKGGMPL1N6HV-3EEF77L34YNAi2JQ-b70nFK_dnYmmv0cYTGUxtGTHkl64UEDLi3u7bV-kbGky3iOOCzXKzDDY6BBKpCRTc2KlbrkO2A2PuDn27WVv1QCNEFHvJN7HxiDDzXOsaUmjrQ3sfrHhzD7S9BcCRkekRfD9g95SKD5J0Fj8NA&token_type=Bearer&refresh_token=kajshdgfkasdjhgfas'
          },
          function (err, data) {
            expect(err).to.eql({
              error: 'invalid_token',
              errorDescription: '`state` does not match.'
            });
            done();
          }
        ); // eslint-disable-line
      });

      it('should fail with an invalid state (available transaction with __enableIdPInitiatedLogin:true)', function (done) {
        var webAuth = new WebAuth({
          domain: 'mdocs.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: '0HP71GSd6PuoRYJ3p',
          responseType: 'token'
        });
        TransactionManager.prototype.getStoredTransaction.restore();
        sinon
          .stub(TransactionManager.prototype, 'getStoredTransaction')
          .callsFake(function () {
            return {
              state: 'not-123'
            };
          });

        var data = webAuth.parseHash(
          {
            hash: '#state=123&access_token=VjubIMBmpgQ2W2&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6IlF6RTROMFpCTTBWRFF6RTJSVVUwTnpJMVF6WTFNelE0UVRrMU16QXdNRUk0UkRneE56RTRSZyJ9.eyJpc3MiOiJodHRwczovL3dwdGVzdC5hdXRoMC5jb20vIiwic3ViIjoiYXV0aDB8NTVkNDhjNTdkNWIwYWQwMjIzYzQwOGQ3IiwiYXVkIjoiZ1lTTmxVNFlDNFYxWVBkcXE4elBRY3VwNnJKdzFNYnQiLCJleHAiOjE0ODI5NjkwMzEsImlhdCI6MTQ4MjkzMzAzMSwibm9uY2UiOiJhc2ZkIn0.PPoh-pITcZ8qbF5l5rMZwXiwk5efbESuqZ0IfMUcamB6jdgLwTxq-HpOT_x5q6-sO1PBHchpSo1WHeDYMlRrOFd9bh741sUuBuXdPQZ3Zb0i2sNOAC2RFB1E11mZn7uNvVPGdPTg-Y5xppz30GSXoOJLbeBszfrVDCmPhpHKGGMPL1N6HV-3EEF77L34YNAi2JQ-b70nFK_dnYmmv0cYTGUxtGTHkl64UEDLi3u7bV-kbGky3iOOCzXKzDDY6BBKpCRTc2KlbrkO2A2PuDn27WVv1QCNEFHvJN7HxiDDzXOsaUmjrQ3sfrHhzD7S9BcCRkekRfD9g95SKD5J0Fj8NA&token_type=Bearer&refresh_token=kajshdgfkasdjhgfas',
            __enableIdPInitiatedLogin: true
          },
          function (err, data) {
            expect(err).to.eql({
              error: 'invalid_token',
              errorDescription: '`state` does not match.'
            });
            done();
          }
        ); // eslint-disable-line
      });
      it('should fail with an invalid state (available transaction with __enableImpersonation:true)', function (done) {
        var webAuth = new WebAuth({
          domain: 'mdocs.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: '0HP71GSd6PuoRYJ3p',
          responseType: 'token'
        });
        TransactionManager.prototype.getStoredTransaction.restore();
        sinon
          .stub(TransactionManager.prototype, 'getStoredTransaction')
          .callsFake(function () {
            return {
              state: 'not-123'
            };
          });

        webAuth.parseHash(
          {
            hash: '#state=123&access_token=VjubIMBmpgQ2W2&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6IlF6RTROMFpCTTBWRFF6RTJSVVUwTnpJMVF6WTFNelE0UVRrMU16QXdNRUk0UkRneE56RTRSZyJ9.eyJpc3MiOiJodHRwczovL3dwdGVzdC5hdXRoMC5jb20vIiwic3ViIjoiYXV0aDB8NTVkNDhjNTdkNWIwYWQwMjIzYzQwOGQ3IiwiYXVkIjoiZ1lTTmxVNFlDNFYxWVBkcXE4elBRY3VwNnJKdzFNYnQiLCJleHAiOjE0ODI5NjkwMzEsImlhdCI6MTQ4MjkzMzAzMSwibm9uY2UiOiJhc2ZkIn0.PPoh-pITcZ8qbF5l5rMZwXiwk5efbESuqZ0IfMUcamB6jdgLwTxq-HpOT_x5q6-sO1PBHchpSo1WHeDYMlRrOFd9bh741sUuBuXdPQZ3Zb0i2sNOAC2RFB1E11mZn7uNvVPGdPTg-Y5xppz30GSXoOJLbeBszfrVDCmPhpHKGGMPL1N6HV-3EEF77L34YNAi2JQ-b70nFK_dnYmmv0cYTGUxtGTHkl64UEDLi3u7bV-kbGky3iOOCzXKzDDY6BBKpCRTc2KlbrkO2A2PuDn27WVv1QCNEFHvJN7HxiDDzXOsaUmjrQ3sfrHhzD7S9BcCRkekRfD9g95SKD5J0Fj8NA&token_type=Bearer&refresh_token=kajshdgfkasdjhgfas',
            __enableImpersonation: true
          },
          function (err, data) {
            expect(err).to.eql({
              error: 'invalid_token',
              errorDescription: '`state` does not match.'
            });
            done();
          }
        ); // eslint-disable-line
      });

      it('should fail with an invalid audience', function (done) {
        var webAuth = new WebAuth({
          domain: 'wptest.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: '0HP71GSd6PuoRYJ3p',
          responseType: 'token'
        });

        webAuth.parseHash(
          {
            hash: '#state=foo&access_token=VjubIMBmpgQ2W2&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6IlF6RTROMFpCTTBWRFF6RTJSVVUwTnpJMVF6WTFNelE0UVRrMU16QXdNRUk0UkRneE56RTRSZyJ9.eyJpc3MiOiJodHRwczovL3dwdGVzdC5hdXRoMC5jb20vIiwic3ViIjoiYXV0aDB8NTVkNDhjNTdkNWIwYWQwMjIzYzQwOGQ3IiwiYXVkIjoiZ1lTTmxVNFlDNFYxWVBkcXE4elBRY3VwNnJKdzFNYnQiLCJleHAiOjE0ODI5NjkwMzEsImlhdCI6MTQ4MjkzMzAzMSwibm9uY2UiOiJhc2ZkIn0.PPoh-pITcZ8qbF5l5rMZwXiwk5efbESuqZ0IfMUcamB6jdgLwTxq-HpOT_x5q6-sO1PBHchpSo1WHeDYMlRrOFd9bh741sUuBuXdPQZ3Zb0i2sNOAC2RFB1E11mZn7uNvVPGdPTg-Y5xppz30GSXoOJLbeBszfrVDCmPhpHKGGMPL1N6HV-3EEF77L34YNAi2JQ-b70nFK_dnYmmv0cYTGUxtGTHkl64UEDLi3u7bV-kbGky3iOOCzXKzDDY6BBKpCRTc2KlbrkO2A2PuDn27WVv1QCNEFHvJN7HxiDDzXOsaUmjrQ3sfrHhzD7S9BcCRkekRfD9g95SKD5J0Fj8NA&token_type=Bearer&refresh_token=kajshdgfkasdjhgfas'
          },
          function (err, data) {
            expect(err).to.eql({
              error: 'invalid_token',
              errorDescription:
                'Audience (aud) claim mismatch in the ID token; expected "0HP71GSd6PuoRYJ3p" but found "gYSNlU4YC4V1YPdqq8zPQcup6rJw1Mbt"' // eslint-disable-line
            });
            done();
          }
        ); // eslint-disable-line
      });

      it('should fail with an invalid issuer', function (done) {
        var webAuth = new WebAuth({
          domain: 'wptest_2.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: '0HP71GSd6PuoRYJ3DXKdiXCUUdGmBbup',
          responseType: 'token'
        });

        webAuth.parseHash(
          {
            hash: '#state=foo&access_token=VjubIMBmpgQ2W2&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6IlF6RTROMFpCTTBWRFF6RTJSVVUwTnpJMVF6WTFNelE0UVRrMU16QXdNRUk0UkRneE56RTRSZyJ9.eyJpc3MiOiJodHRwczovL3dwdGVzdC5hdXRoMC5jb20vIiwic3ViIjoiYXV0aDB8NTVkNDhjNTdkNWIwYWQwMjIzYzQwOGQ3IiwiYXVkIjoiZ1lTTmxVNFlDNFYxWVBkcXE4elBRY3VwNnJKdzFNYnQiLCJleHAiOjE0ODI5NjkwMzEsImlhdCI6MTQ4MjkzMzAzMSwibm9uY2UiOiJhc2ZkIn0.PPoh-pITcZ8qbF5l5rMZwXiwk5efbESuqZ0IfMUcamB6jdgLwTxq-HpOT_x5q6-sO1PBHchpSo1WHeDYMlRrOFd9bh741sUuBuXdPQZ3Zb0i2sNOAC2RFB1E11mZn7uNvVPGdPTg-Y5xppz30GSXoOJLbeBszfrVDCmPhpHKGGMPL1N6HV-3EEF77L34YNAi2JQ-b70nFK_dnYmmv0cYTGUxtGTHkl64UEDLi3u7bV-kbGky3iOOCzXKzDDY6BBKpCRTc2KlbrkO2A2PuDn27WVv1QCNEFHvJN7HxiDDzXOsaUmjrQ3sfrHhzD7S9BcCRkekRfD9g95SKD5J0Fj8NA&token_type=Bearer&refresh_token=kajshdgfkasdjhgfas'
          },
          function (err, data) {
            expect(err).to.eql({
              error: 'invalid_token',
              errorDescription:
                'Issuer (iss) claim mismatch in the ID token, expected "https://wptest_2.auth0.com/", found "https://wptest.auth0.com/"' // eslint-disable-line
            });
            done();
          }
        ); // eslint-disable-line
      });

      it('should fail if there is no token', function (done) {
        var webAuth = new WebAuth({
          domain: 'mdocs_2.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: '0HP71GSd6PuoRYJ3DXKdiXCUUdGmBbup',
          responseType: 'id_token'
        });

        var data = webAuth.parseHash(
          {
            hash: '#token_type=Bearer'
          },
          function (err, data) {
            expect(err).to.be(null);
            expect(data).to.be(null);
            done();
          }
        ); // eslint-disable-line
      });

      it('should parse an error response', function (done) {
        var webAuth = new WebAuth({
          domain: 'mdocs_2.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: '0HP71GSd6PuoRYJ3DXKdiXCUUdGmBbup',
          responseType: 'token'
        });

        webAuth.parseHash(
          {
            hash: '#error=the_error_code&error_description=the_error_description&state=some_state'
          },
          function (err, data) {
            expect(err).to.eql({
              error: 'the_error_code',
              errorDescription: 'the_error_description',
              state: 'some_state'
            });
            done();
          }
        );
      });

      it('should return default error if it is not a validation error', function (done) {
        var expectedError = { error: 'some_error' };
        sinon
          .stub(WebAuth.prototype, 'validateToken')
          .callsFake(function (token, nonce, callback) {
            return callback(expectedError);
          });
        var webAuth = new WebAuth({
          domain: 'mdocs_2.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: '0HP71GSd6PuoRYJ3DXKdiXCUUdGmBbup',
          responseType: 'id_token'
        });

        var data = webAuth.parseHash(
          {
            hash: '#state=foo&token_type=Bearer&id_token=0as98da09s8d_not_a_token'
          },
          function (err, data) {
            expect(err).to.be.eql(expectedError);
            done();
          }
        );
      });
      describe('should throw invalid_hash error', function () {
        afterEach(function () {
          if (WebAuth.prototype.validateAuthenticationResponse.restore) {
            WebAuth.prototype.validateAuthenticationResponse.restore();
          }
        });
        it('does not validate when there is no responseType set', function (done) {
          sinon
            .stub(WebAuth.prototype, 'validateAuthenticationResponse')
            .callsFake(function () {
              done();
            });
          var webAuth = new WebAuth({
            domain: 'mdocs_2.auth0.com',
            redirectUri: 'http://example.com/callback',
            clientID: '0HP71GSd6PuoRYJ3DXKdiXCUUdGmBbup'
          });

          webAuth.parseHash({
            hash: '#state=foo&token_type=Bearer&id_token=0as98da09s8d_not_a_token'
          });
        });
        it('when baseoptions.response_type includes token but parsedHash has no access_token', function (done) {
          var expectedError = {
            error: 'invalid_hash',
            errorDescription:
              'response_type contains `token`, but the parsed hash does not contain an `access_token` property'
          };
          var webAuth = new WebAuth({
            domain: 'mdocs_2.auth0.com',
            redirectUri: 'http://example.com/callback',
            clientID: '0HP71GSd6PuoRYJ3DXKdiXCUUdGmBbup',
            responseType: 'code token'
          });

          var data = webAuth.parseHash(
            {
              hash: '#state=foo&token_type=Bearer&id_token=0as98da09s8d_not_a_token'
            },
            function (err, data) {
              expect(err).to.be.eql(expectedError);
              done();
            }
          );
        });
        it('when baseoptions.response_type includes id_token but parsedHash has no id_token', function (done) {
          var expectedError = {
            error: 'invalid_hash',
            errorDescription:
              'response_type contains `id_token`, but the parsed hash does not contain an `id_token` property'
          };
          var webAuth = new WebAuth({
            domain: 'mdocs_2.auth0.com',
            redirectUri: 'http://example.com/callback',
            clientID: '0HP71GSd6PuoRYJ3DXKdiXCUUdGmBbup',
            responseType: 'code id_token'
          });

          var data = webAuth.parseHash(
            {
              hash: '#state=foo&token_type=Bearer&access_token=0as98da09s8d_not_a_token'
            },
            function (err, data) {
              expect(err).to.be.eql(expectedError);
              done();
            }
          );
        });
        it('when options.response_type includes token but parsedHash has no access_token', function (done) {
          var expectedError = {
            error: 'invalid_hash',
            errorDescription:
              'response_type contains `token`, but the parsed hash does not contain an `access_token` property'
          };
          var webAuth = new WebAuth({
            domain: 'mdocs_2.auth0.com',
            redirectUri: 'http://example.com/callback',
            clientID: '0HP71GSd6PuoRYJ3DXKdiXCUUdGmBbup'
          });

          var data = webAuth.parseHash(
            {
              hash: '#state=foo&token_type=Bearer&id_token=0as98da09s8d_not_a_token',
              responseType: 'code token'
            },
            function (err, data) {
              expect(err).to.be.eql(expectedError);
              done();
            }
          );
        });
        it('when options.response_type includes id_token but parsedHash has no id_token', function (done) {
          var expectedError = {
            error: 'invalid_hash',
            errorDescription:
              'response_type contains `id_token`, but the parsed hash does not contain an `id_token` property'
          };
          var webAuth = new WebAuth({
            domain: 'mdocs_2.auth0.com',
            redirectUri: 'http://example.com/callback',
            clientID: '0HP71GSd6PuoRYJ3DXKdiXCUUdGmBbup'
          });

          var data = webAuth.parseHash(
            {
              hash: '#state=foo&token_type=Bearer&access_token=0as98da09s8d_not_a_token',
              responseType: 'code id_token'
            },
            function (err, data) {
              expect(err).to.be.eql(expectedError);
              done();
            }
          );
        });
      });
    });
    context('with HS256 id_token', function () {
      beforeEach(function () {
        this.webAuth = new WebAuth({
          domain: 'auth0-tests-lock.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: 'ixeOHFhD7NSPxEQK6CFcswjUsa5YkcXS',
          responseType: 'token id_token'
        });
      });

      afterEach(function () {
        if (this.webAuth.client.userInfo.restore) {
          this.webAuth.client.userInfo.restore();
        }
        if (IdTokenVerifier.prototype.verify.restore) {
          IdTokenVerifier.prototype.verify.restore();
        }
      });

      it('should use result from /userinfo as idTokenPayload', function (done) {
        sinon
          .stub(this.webAuth.client, 'userInfo')
          .callsFake(function (accessToken, cb) {
            expect(accessToken).to.be('VjubIMBmpgQ2W2');
            cb(null, { from: 'userinfo' });
          });

        this.webAuth.parseHash(
          {
            nonce: 'the-nonce',
            hash: '#state=foo&access_token=VjubIMBmpgQ2W2&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJPbmxpbmUgSldUIEJ1aWxkZXIiLCJpYXQiOjE1NjA4ODU1NzgsImV4cCI6MTU5MjQyMTU3OCwiYXVkIjoid3d3LmV4YW1wbGUuY29tIiwic3ViIjoianJvY2tldEBleGFtcGxlLmNvbSIsIm5vbmNlIjoidGhlLW5vbmNlIn0.jb9aG21kGibxKPIyfn8FfvjQ3ykJGiBGcep2hDHHfqk&token_type=Bearer&refresh_token=kajshdgfkasdjhgfas'
          },
          function (err, data) {
            expect(err).to.be(null);
            expect(data).to.be.eql({
              accessToken: 'VjubIMBmpgQ2W2',
              idToken:
                'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJPbmxpbmUgSldUIEJ1aWxkZXIiLCJpYXQiOjE1NjA4ODU1NzgsImV4cCI6MTU5MjQyMTU3OCwiYXVkIjoid3d3LmV4YW1wbGUuY29tIiwic3ViIjoianJvY2tldEBleGFtcGxlLmNvbSIsIm5vbmNlIjoidGhlLW5vbmNlIn0.jb9aG21kGibxKPIyfn8FfvjQ3ykJGiBGcep2hDHHfqk',
              idTokenPayload: { from: 'userinfo' },
              appState: null,
              refreshToken: 'kajshdgfkasdjhgfas',
              state: 'foo',
              expiresIn: null,
              tokenType: 'Bearer',
              scope: null
            });
            done();
          }
        );
      });

      it('should not throw an error when the payload.nonce is undefined and transactionNonce is null', function (done) {
        TransactionManager.prototype.getStoredTransaction.restore();
        sinon
          .stub(TransactionManager.prototype, 'getStoredTransaction')
          .callsFake(function () {
            return {
              nonce: null,
              state: 'foo'
            };
          });
        var webAuth = new WebAuth({
          domain: 'auth0-tests-lock.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: 'ixeOHFhD7NSPxEQK6CFcswjUsa5YkcXS',
          responseType: 'id_token'
        });

        sinon
          .stub(webAuth.client, 'userInfo')
          .callsFake(function (accessToken, cb) {
            expect(accessToken).to.be('VjubIMBmpgQ2W2');
            cb(null, { from: 'userinfo' });
          });

        sinon
          .stub(IdTokenVerifier.prototype, 'verify')
          .callsFake(function (_, __, cb) {
            cb({ error: true });
          });

        //nonce: undefined
        webAuth.parseHash(
          {
            hash: '#state=foo&access_token=VjubIMBmpgQ2W2&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJPbmxpbmUgSldUIEJ1aWxkZXIiLCJpYXQiOjE1NjE2NjM3ODMsImV4cCI6MTU5MzE5OTc4MywiYXVkIjoid3d3LmV4YW1wbGUuY29tIiwic3ViIjoianJvY2tldEBleGFtcGxlLmNvbSJ9.Hoq1Go3McuHgSMg9rWVxQsEenoDWYi5MEumc32Ah9CQ&token_type=Bearer&refresh_token=kajshdgfkasdjhgfas'
          },
          function (err, data) {
            expect(err).to.be(null);
            expect(data).to.be.eql({
              accessToken: 'VjubIMBmpgQ2W2',
              idToken:
                'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJPbmxpbmUgSldUIEJ1aWxkZXIiLCJpYXQiOjE1NjE2NjM3ODMsImV4cCI6MTU5MzE5OTc4MywiYXVkIjoid3d3LmV4YW1wbGUuY29tIiwic3ViIjoianJvY2tldEBleGFtcGxlLmNvbSJ9.Hoq1Go3McuHgSMg9rWVxQsEenoDWYi5MEumc32Ah9CQ',
              idTokenPayload: { from: 'userinfo' },
              appState: null,
              refreshToken: 'kajshdgfkasdjhgfas',
              state: 'foo',
              expiresIn: null,
              tokenType: 'Bearer',
              scope: null
            });
            done();
          }
        );
      });

      it('should still throw an error with an invalid nonce', function (done) {
        var webAuth = new WebAuth({
          domain: 'auth0-tests-lock.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: 'ixeOHFhD7NSPxEQK6CFcswjUsa5YkcXS',
          responseType: 'id_token'
        });
        sinon
          .stub(IdTokenVerifier.prototype, 'verify')
          .callsFake(function (_, __, cb) {
            cb({ error: true });
          });

        //nonce: the-nonce
        webAuth.parseHash(
          {
            hash: '#state=foo&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJPbmxpbmUgSldUIEJ1aWxkZXIiLCJpYXQiOjE1NjA4ODU1NzgsImV4cCI6MTU5MjQyMTU3OCwiYXVkIjoid3d3LmV4YW1wbGUuY29tIiwic3ViIjoianJvY2tldEBleGFtcGxlLmNvbSIsIm5vbmNlIjoidGhlLW5vbmNlIn0.jb9aG21kGibxKPIyfn8FfvjQ3ykJGiBGcep2hDHHfqk&token_type=Bearer&refresh_token=kajshdgfkasdjhgfas'
          },
          function (err, data) {
            expect(err).to.be.eql({
              error: 'invalid_token',
              errorDescription:
                'Nonce (nonce) claim value mismatch in the ID token; expected "asfd", found "the-nonce"'
            });
            done();
          }
        );
      });

      it('should still throw an error with an invalid state', function (done) {
        var webAuth = new WebAuth({
          domain: 'auth0-tests-lock.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: 'ixeOHFhD7NSPxEQK6CFcswjUsa5YkcXS',
          responseType: 'id_token'
        });
        sinon
          .stub(IdTokenVerifier.prototype, 'verify')
          .callsFake(function (_, __, cb) {
            cb({ error: true });
          });

        //nonce: the-nonce
        webAuth.parseHash(
          {
            hash: '#state=ignore-test-state-check&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJPbmxpbmUgSldUIEJ1aWxkZXIiLCJpYXQiOjE1NjA4ODU1NzgsImV4cCI6MTU5MjQyMTU3OCwiYXVkIjoid3d3LmV4YW1wbGUuY29tIiwic3ViIjoianJvY2tldEBleGFtcGxlLmNvbSIsIm5vbmNlIjoidGhlLW5vbmNlIn0.jb9aG21kGibxKPIyfn8FfvjQ3ykJGiBGcep2hDHHfqk&token_type=Bearer&refresh_token=kajshdgfkasdjhgfas'
          },
          function (err, data) {
            expect(err).to.be.eql({
              error: 'invalid_token',
              errorDescription: '`state` does not match.'
            });
            done();
          }
        );
      });
      it('should throw an error when there is no access_token to call /userinfo', function (done) {
        var webAuth = new WebAuth({
          domain: 'auth0-tests-lock.auth0.com',
          redirectUri: 'http://example.com/callback',
          clientID: 'ixeOHFhD7NSPxEQK6CFcswjUsa5YkcXS',
          responseType: 'id_token'
        });
        sinon
          .stub(webAuth.client, 'userInfo')
          .callsFake(function (accessToken, cb) {
            cb({ any: 'error' });
          });

        webAuth.parseHash(
          {
            nonce: 'the-nonce',
            hash: '#state=foo&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJPbmxpbmUgSldUIEJ1aWxkZXIiLCJpYXQiOjE1NjA4ODU1NzgsImV4cCI6MTU5MjQyMTU3OCwiYXVkIjoid3d3LmV4YW1wbGUuY29tIiwic3ViIjoianJvY2tldEBleGFtcGxlLmNvbSIsIm5vbmNlIjoidGhlLW5vbmNlIn0.jb9aG21kGibxKPIyfn8FfvjQ3ykJGiBGcep2hDHHfqk&token_type=Bearer&refresh_token=kajshdgfkasdjhgfas'
          },
          function (err, data) {
            expect(err).to.be.eql({
              error: 'invalid_token',
              description:
                'The id_token cannot be validated because it was signed with the HS256 algorithm and public clients (like a browser) can’t store secrets. Please read the associated doc for possible ways to fix this. Read more: https://auth0.com/docs/errors/libraries/auth0-js/invalid-token#parsing-an-hs256-signed-id-token-without-an-access-token'
            });
            done();
          }
        );
      });
      it('should throw original userinfo error when /userinfo call has an error', function (done) {
        sinon
          .stub(this.webAuth.client, 'userInfo')
          .callsFake(function (accessToken, cb) {
            cb({ any: 'error' });
          });

        this.webAuth.parseHash(
          {
            nonce: 'the-nonce',
            hash: '#state=foo&access_token=VjubIMBmpgQ2W2&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJPbmxpbmUgSldUIEJ1aWxkZXIiLCJpYXQiOjE1NjA4ODU1NzgsImV4cCI6MTU5MjQyMTU3OCwiYXVkIjoid3d3LmV4YW1wbGUuY29tIiwic3ViIjoianJvY2tldEBleGFtcGxlLmNvbSIsIm5vbmNlIjoidGhlLW5vbmNlIn0.jb9aG21kGibxKPIyfn8FfvjQ3ykJGiBGcep2hDHHfqk&token_type=Bearer&refresh_token=kajshdgfkasdjhgfas'
          },
          function (err, data) {
            expect(err).to.be.eql({ any: 'error' });
            done();
          }
        );
      });
    });
  });

  context('renewAuth', function () {
    beforeEach(function () {
      global.window = {
        origin: 'unit-test-origin',
        removeEventListener: function () {}
      };
    });
    afterEach(function () {
      delete global.window;
      SilentAuthenticationHandler.prototype.login.restore();
    });

    it('should pass the correct authorize url', function (done) {
      sinon
        .stub(SilentAuthenticationHandler.prototype, 'login')
        .callsFake(function () {
          expect(this.authenticationUrl).to.be(
            'https://me.auth0.com/authorize?client_id=...&response_type=id_token&redirect_uri=http%3A%2F%2Fpage.com%2Fcallback&scope=openid%20name%20read%3Ablog&audience=urn%3Asite%3Ademo%3Ablog&nonce=123&state=456&response_mode=fragment&prompt=none'
          );
          done();
        });

      var webAuth = new WebAuth({
        domain: 'me.auth0.com',
        redirectUri: 'http://page.com/callback',
        clientID: '...',
        responseType: 'id_token',
        scope: 'openid name read:blog',
        audience: 'urn:site:demo:blog',
        _sendTelemetry: false
      });

      var options = {
        nonce: '123',
        state: '456'
      };

      webAuth.renewAuth(options, function () {});
    });

    it('should pass the correct timeout', function (done) {
      sinon
        .stub(SilentAuthenticationHandler.prototype, 'login')
        .callsFake(function () {
          expect(this.timeout).to.be(5000);
          done();
        });

      var webAuth = new WebAuth({
        domain: 'me.auth0.com',
        redirectUri: 'http://page.com/callback',
        clientID: '...',
        responseType: 'id_token',
        scope: 'openid name read:blog',
        audience: 'urn:site:demo:blog',
        _sendTelemetry: false
      });

      var options = {
        nonce: '123',
        state: '456',
        timeout: 5000
      };

      webAuth.renewAuth(options, function () {});
    });
  });

  context('authorize', function () {
    beforeEach(function () {
      global.window = { location: '' };
    });
    afterEach(function () {
      delete global.window;
    });
    it('should default scope to openid profile email', function (done) {
      var webAuth = new WebAuth({
        domain: 'me.auth0.com',
        redirectUri: 'http://page.com/callback',
        clientID: '...',
        responseType: 'token',
        _sendTelemetry: false
      });
      sinon.stub(windowHelper, 'redirect').callsFake(function (url) {
        expect(url).to.be(
          'https://me.auth0.com/authorize?client_id=...&response_type=token&redirect_uri=http%3A%2F%2Fpage.com%2Fcallback&connection=foobar&state=randomState&scope=openid%20profile%20email'
        );
        windowHelper.redirect.restore();
        done();
      });

      webAuth.authorize({ connection: 'foobar' });
    });
    it('should check that responseType is present', function () {
      var webAuth = new WebAuth({
        domain: 'me.auth0.com',
        redirectUri: 'http://page.com/callback',
        clientID: '...',
        scope: 'openid name read:blog',
        audience: 'urn:site:demo:blog',
        _sendTelemetry: false
      });

      expect(function () {
        webAuth.authorize({ connection: 'facebook' });
      }).to.throwException(function (e) {
        expect(e.message).to.be('responseType option is required');
      });
    });
    it('should pass organization and invitation params to buildAuthorizeUrl from the constructor', function () {
      var webAuth = new WebAuth({
        domain: 'me.auth0.com',
        redirectUri: 'http://page.com/callback',
        clientID: '...',
        responseType: 'id_token',
        scope: 'openid name read:blog',
        audience: 'urn:site:demo:blog',
        _sendTelemetry: false,
        organization: 'org_123',
        invitation: 'inv_123'
      });

      sinon.spy(webAuth.client, 'buildAuthorizeUrl');

      webAuth.authorize();

      var args = webAuth.client.buildAuthorizeUrl.lastCall.args[0];

      expect(args.organization).to.eql('org_123');
      expect(args.invitation).to.eql('inv_123');
    });
    it('should pass organization and invitation params to buildAuthorizeUrl from the authorize method', function () {
      var webAuth = new WebAuth({
        domain: 'me.auth0.com',
        redirectUri: 'http://page.com/callback',
        clientID: '...',
        responseType: 'id_token',
        scope: 'openid name read:blog',
        audience: 'urn:site:demo:blog',
        _sendTelemetry: false
      });

      sinon.spy(webAuth.client, 'buildAuthorizeUrl');

      webAuth.authorize({ organization: 'org_123', invitation: 'inv_123' });

      var args = webAuth.client.buildAuthorizeUrl.lastCall.args[0];

      expect(args.organization).to.eql('org_123');
      expect(args.invitation).to.eql('inv_123');
    });
  });

  context('renewAuth', function () {
    beforeEach(function () {
      global.window = {
        document: {},
        origin: 'unit-test-origin'
      };
    });

    afterEach(function () {
      delete global.window;
      SilentAuthenticationHandler.prototype.login.restore();
    });

    it('should validate the token', function (done) {
      sinon
        .stub(SilentAuthenticationHandler.prototype, 'login')
        .callsFake(function (usePostMessage, cb) {
          cb(
            null,
            '#state=foo&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6IlF6RTROMFpCTTBWRFF6RTJSVVUwTnpJMVF6WTFNelE0UVRrMU16QXdNRUk0UkRneE56RTRSZyJ9.eyJpc3MiOiJodHRwczovL3dwdGVzdC5hdXRoMC5jb20vIiwic3ViIjoiYXV0aDB8NTVkNDhjNTdkNWIwYWQwMjIzYzQwOGQ3IiwiYXVkIjoiZ1lTTmxVNFlDNFYxWVBkcXE4elBRY3VwNnJKdzFNYnQiLCJleHAiOjE0ODI5NjkwMzEsImlhdCI6MTQ4MjkzMzAzMSwibm9uY2UiOiJhc2ZkIn0.PPoh-pITcZ8qbF5l5rMZwXiwk5efbESuqZ0IfMUcamB6jdgLwTxq-HpOT_x5q6-sO1PBHchpSo1WHeDYMlRrOFd9bh741sUuBuXdPQZ3Zb0i2sNOAC2RFB1E11mZn7uNvVPGdPTg-Y5xppz30GSXoOJLbeBszfrVDCmPhpHKGGMPL1N6HV-3EEF77L34YNAi2JQ-b70nFK_dnYmmv0cYTGUxtGTHkl64UEDLi3u7bV-kbGky3iOOCzXKzDDY6BBKpCRTc2KlbrkO2A2PuDn27WVv1QCNEFHvJN7HxiDDzXOsaUmjrQ3sfrHhzD7S9BcCRkekRfD9g95SKD5J0Fj8NA'
          );
        });
      TransactionManager.prototype.getStoredTransaction.restore();
      sinon
        .stub(TransactionManager.prototype, 'getStoredTransaction')
        .callsFake(function () {
          return {
            nonce: 'asfd',
            state: 'foo'
          };
        });

      var webAuth = new WebAuth({
        domain: 'wptest.auth0.com',
        redirectUri: 'http://page.com/callback',
        clientID: 'gYSNlU4YC4V1YPdqq8zPQcup6rJw1Mbt',
        responseType: 'id_token',
        scope: 'openid name read:blog',
        audience: 'urn:site:demo:blog',
        _sendTelemetry: false,
        __clock: () => new Date(1482933050000)
      });

      var options = {
        nonce: 'asfd'
      };

      webAuth.renewAuth(options, function (err, data) {
        expect(err).to.be(null);
        expect(data).to.eql({
          accessToken: null,
          idToken:
            'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6IlF6RTROMFpCTTBWRFF6RTJSVVUwTnpJMVF6WTFNelE0UVRrMU16QXdNRUk0UkRneE56RTRSZyJ9.eyJpc3MiOiJodHRwczovL3dwdGVzdC5hdXRoMC5jb20vIiwic3ViIjoiYXV0aDB8NTVkNDhjNTdkNWIwYWQwMjIzYzQwOGQ3IiwiYXVkIjoiZ1lTTmxVNFlDNFYxWVBkcXE4elBRY3VwNnJKdzFNYnQiLCJleHAiOjE0ODI5NjkwMzEsImlhdCI6MTQ4MjkzMzAzMSwibm9uY2UiOiJhc2ZkIn0.PPoh-pITcZ8qbF5l5rMZwXiwk5efbESuqZ0IfMUcamB6jdgLwTxq-HpOT_x5q6-sO1PBHchpSo1WHeDYMlRrOFd9bh741sUuBuXdPQZ3Zb0i2sNOAC2RFB1E11mZn7uNvVPGdPTg-Y5xppz30GSXoOJLbeBszfrVDCmPhpHKGGMPL1N6HV-3EEF77L34YNAi2JQ-b70nFK_dnYmmv0cYTGUxtGTHkl64UEDLi3u7bV-kbGky3iOOCzXKzDDY6BBKpCRTc2KlbrkO2A2PuDn27WVv1QCNEFHvJN7HxiDDzXOsaUmjrQ3sfrHhzD7S9BcCRkekRfD9g95SKD5J0Fj8NA',
          idTokenPayload: {
            iss: 'https://wptest.auth0.com/',
            sub: 'auth0|55d48c57d5b0ad0223c408d7',
            aud: 'gYSNlU4YC4V1YPdqq8zPQcup6rJw1Mbt',
            exp: 1482969031,
            iat: 1482933031,
            nonce: 'asfd'
          },
          appState: null,
          refreshToken: null,
          state: 'foo',
          expiresIn: null,
          tokenType: null,
          scope: null
        });

        done();
      });
    });
    describe('should return the access_token', function () {
      beforeEach(function () {
        global.window = { origin: 'unit-test-origin' };
      });
      afterEach(function () {
        delete global.window;
      });
      it('when login returns an object', function (done) {
        sinon
          .stub(SilentAuthenticationHandler.prototype, 'login')
          .callsFake(function (usePostMessage, cb) {
            cb(null, { accessToken: '123' });
          });

        var webAuth = new WebAuth({
          domain: 'mdocs.auth0.com',
          redirectUri: 'http://page.com/callback',
          clientID: '0HP71GSd6PuoRYJ3DXKdiXCUUdGmBbup',
          responseType: 'token',
          scope: 'openid name read:blog',
          audience: 'urn:site:demo:blog',
          _sendTelemetry: false
        });

        var options = {};

        webAuth.renewAuth(options, function (err, data) {
          expect(err).to.be(null);
          expect(data).to.eql({
            accessToken: '123'
          });
          done();
        });
      });
      it('when login returns a string', function (done) {
        sinon
          .stub(SilentAuthenticationHandler.prototype, 'login')
          .callsFake(function (usePostMessage, cb) {
            cb(
              null,
              '#state=foo&access_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1'
            );
          });

        var webAuth = new WebAuth({
          domain: 'mdocs.auth0.com',
          redirectUri: 'http://page.com/callback',
          clientID: '0HP71GSd6PuoRYJ3DXKdiXCUUdGmBbup',
          responseType: 'token',
          scope: 'openid name read:blog',
          audience: 'urn:site:demo:blog',
          _sendTelemetry: false
        });

        var options = {};

        webAuth.renewAuth(options, function (err, data) {
          expect(err).to.be(null);
          expect(data).to.eql({
            accessToken: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1',
            idToken: null,
            idTokenPayload: null,
            appState: null,
            refreshToken: null,
            state: 'foo',
            expiresIn: null,
            tokenType: null,
            scope: null
          });
          done();
        });
      });
    });

    it('should validate the token and fail with invalid audience error', function (done) {
      sinon
        .stub(SilentAuthenticationHandler.prototype, 'login')
        .callsFake(function (usePostMessage, cb) {
          cb(
            null,
            '#state=foo&access_token=123&id_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6IlF6RTROMFpCTTBWRFF6RTJSVVUwTnpJMVF6WTFNelE0UVRrMU16QXdNRUk0UkRneE56RTRSZyJ9.eyJpc3MiOiJodHRwczovL3dwdGVzdC5hdXRoMC5jb20vIiwic3ViIjoiYXV0aDB8NTVkNDhjNTdkNWIwYWQwMjIzYzQwOGQ3IiwiYXVkIjoiZ1lTTmxVNFlDNFYxWVBkcXE4elBRY3VwNnJKdzFNYnQiLCJleHAiOjE0ODI5NjkwMzEsImlhdCI6MTQ4MjkzMzAzMSwibm9uY2UiOiJhc2ZkIn0.PPoh-pITcZ8qbF5l5rMZwXiwk5efbESuqZ0IfMUcamB6jdgLwTxq-HpOT_x5q6-sO1PBHchpSo1WHeDYMlRrOFd9bh741sUuBuXdPQZ3Zb0i2sNOAC2RFB1E11mZn7uNvVPGdPTg-Y5xppz30GSXoOJLbeBszfrVDCmPhpHKGGMPL1N6HV-3EEF77L34YNAi2JQ-b70nFK_dnYmmv0cYTGUxtGTHkl64UEDLi3u7bV-kbGky3iOOCzXKzDDY6BBKpCRTc2KlbrkO2A2PuDn27WVv1QCNEFHvJN7HxiDDzXOsaUmjrQ3sfrHhzD7S9BcCRkekRfD9g95SKD5J0Fj8NA'
          );
        });

      var webAuth = new WebAuth({
        domain: 'wptest.auth0.com',
        redirectUri: 'http://page.com/callback',
        clientID: '...',
        responseType: 'id_token',
        scope: 'openid name read:blog',
        audience: 'urn:site:demo:blog',
        _sendTelemetry: false
      });

      var options = {
        nonce: '123'
      };

      webAuth.renewAuth(options, function (err, data) {
        expect(data).to.be(undefined);
        expect(err).to.eql({
          error: 'invalid_token',
          errorDescription:
            'Audience (aud) claim mismatch in the ID token; expected "..." but found "gYSNlU4YC4V1YPdqq8zPQcup6rJw1Mbt"'
        });
        done();
      });
    });
  });

  context('change password', function () {
    before(function () {
      this.auth0 = new WebAuth({
        domain: 'me.auth0.com',
        clientID: '...',
        redirectUri: 'http://page.com/callback',
        responseType: 'code',
        _sendTelemetry: false
      });
    });

    afterEach(function () {
      request.post.restore();
    });

    it('should call db-connection changePassword with all the options', function (done) {
      sinon.stub(request, 'post').callsFake(function (url) {
        expect(url).to.be('https://me.auth0.com/dbconnections/change_password');
        return new RequestMock({
          body: {
            client_id: '...',
            connection: 'the_connection',
            email: 'me@example.com'
          },
          headers: {
            'Content-Type': 'application/json'
          },
          cb: function (cb) {
            cb(null, {});
          }
        });
      });

      this.auth0.changePassword(
        {
          connection: 'the_connection',
          email: 'me@example.com'
        },
        function (err) {
          expect(err).to.be(null);
          done();
        }
      );
    });

    it('should call db-connection changePassword should ignore password option', function (done) {
      sinon.stub(request, 'post').callsFake(function (url) {
        expect(url).to.be('https://me.auth0.com/dbconnections/change_password');
        return new RequestMock({
          body: {
            client_id: '...',
            connection: 'the_connection',
            email: 'me@example.com'
          },
          headers: {
            'Content-Type': 'application/json'
          },
          cb: function (cb) {
            cb(null, {});
          }
        });
      });

      this.auth0.changePassword(
        {
          connection: 'the_connection',
          email: 'me@example.com',
          password: '123456'
        },
        function (err) {
          expect(err).to.be(null);
          done();
        }
      );
    });
  });

  context('passwordless start', function () {
    before(function () {
      this.auth0 = new WebAuth({
        domain: 'me.auth0.com',
        clientID: '...',
        redirectUri: 'http://page.com/callback',
        responseType: 'code',
        _sendTelemetry: false
      });
    });

    afterEach(function () {
      TransactionManager.prototype.process.restore();
      if (request.post.restore) {
        request.post.restore();
      }
      if (this.auth0.client.passwordless.start.restore) {
        this.auth0.client.passwordless.start.restore();
      }
    });
    it('should call `transactionManager.process` with merged params', function () {
      sinon
        .stub(this.auth0.client.passwordless, 'start')
        .callsFake(function () {});
      sinon.spy(TransactionManager.prototype, 'process');
      var expectedOptions = {
        responseType: 'code',
        redirectUri: 'http://page.com/callback',
        auth: 'params',
        state: 'randomState'
      };

      this.auth0.passwordlessStart(
        {
          connection: 'sms',
          phoneNumber: '+55165134',
          verificationCode: '123456',
          authParams: {
            auth: 'params'
          }
        },
        function (err, data) {
          return 'cb';
        }
      );
      var mock = TransactionManager.prototype.process;
      expect(mock.calledOnce).to.be(true);
      expect(mock.firstCall.args[0]).to.be.eql(expectedOptions);
    });
    it('should call `passwordless.start` with params from transactionManager', function () {
      var expectedOptions = {
        authParams: {
          from: 'transactionManager'
        }
      };
      var mockVerify = sinon
        .stub(this.auth0.client.passwordless, 'start')
        .callsFake(function () {});
      sinon
        .stub(TransactionManager.prototype, 'process')
        .callsFake(function () {
          return expectedOptions.authParams;
        });

      this.auth0.passwordlessStart({}, function (err, data) {
        return 'cb';
      });
      expect(mockVerify.calledOnce).to.be(true);
      expect(mockVerify.firstCall.args[0]).to.be.eql(expectedOptions);
    });

    it('should call passwordless start sms with all the options', function (done) {
      sinon.stub(request, 'post').callsFake(function (url) {
        expect(url).to.be('https://me.auth0.com/passwordless/start');
        return new RequestMock({
          body: {
            client_id: '...',
            connection: 'the_connection',
            phone_number: '123456',
            send: 'code',
            authParams: {
              redirect_uri: 'http://page.com/callback',
              response_type: 'code',
              from: 'tm'
            }
          },
          headers: {
            'Content-Type': 'application/json'
          },
          cb: function (cb) {
            cb(null, {
              body: {}
            });
          }
        });
      });

      sinon
        .stub(TransactionManager.prototype, 'process')
        .callsFake(function () {
          return { from: 'tm' };
        });

      this.auth0.passwordlessStart(
        {
          connection: 'the_connection',
          phoneNumber: '123456',
          send: 'code'
        },
        function (err, data) {
          expect(err).to.be(null);
          expect(data).to.eql({});
          done();
        }
      );
    });

    it('should call passwordless start email with all the options', function (done) {
      sinon.stub(request, 'post').callsFake(function (url) {
        expect(url).to.be('https://me.auth0.com/passwordless/start');
        return new RequestMock({
          body: {
            client_id: '...',
            connection: 'the_connection',
            email: 'me@example.com',
            send: 'code',
            authParams: {
              redirect_uri: 'http://page.com/callback',
              response_type: 'code',
              from: 'tm'
            }
          },
          headers: {
            'Content-Type': 'application/json'
          },
          cb: function (cb) {
            cb(null, {
              body: {}
            });
          }
        });
      });

      sinon
        .stub(TransactionManager.prototype, 'process')
        .callsFake(function () {
          return { from: 'tm' };
        });

      this.auth0.passwordlessStart(
        {
          connection: 'the_connection',
          email: 'me@example.com',
          send: 'code'
        },
        function (err, data) {
          expect(err).to.be(null);
          expect(data).to.eql({});
          done();
        }
      );
    });
  });

  context('passwordlessLogin', function () {
    beforeEach(function () {
      this.auth0 = new WebAuth({
        domain: 'me.auth0.com',
        clientID: '...',
        redirectUri: 'http://page.com/callback',
        responseType: 'id_token',
        _sendTelemetry: false
      });
    });
    context('when outside of the universal login page', function () {
      beforeEach(function () {
        sinon.stub(windowHelper, 'getWindow').callsFake(function () {
          return {
            location: {
              host: 'other-domain.auth0.com'
            }
          };
        });
      });

      afterEach(function () {
        windowHelper.getWindow.restore();
        if (CrossOriginAuthentication.prototype.login.restore) {
          CrossOriginAuthentication.prototype.login.restore();
        }
        if (CrossOriginAuthentication.prototype.callback.restore) {
          CrossOriginAuthentication.prototype.callback.restore();
        }
      });
      it('should call `crossOriginAuthentication.login` with phoneNumber', function (done) {
        var expectedOptions = {
          credentialType: 'http://auth0.com/oauth/grant-type/passwordless/otp',
          realm: 'sms',
          username: '+55165134',
          otp: '123456',
          clientID: '...',
          responseType: 'id_token',
          redirectUri: 'http://page.com/callback',
          state: 'randomState',
          nonce: 'randomNonce'
        };
        sinon
          .stub(CrossOriginAuthentication.prototype, 'login')
          .callsFake(function (options, cb) {
            expect(options).to.be.eql(expectedOptions);
            expect(cb()).to.be('cb');
            done();
          });

        this.auth0.passwordlessLogin(
          {
            connection: 'sms',
            phoneNumber: '+55165134',
            verificationCode: '123456'
          },
          function (err, data) {
            return 'cb';
          }
        );
      });
      it('should call `crossOriginAuthentication.login` with email', function (done) {
        var expectedOptions = {
          credentialType: 'http://auth0.com/oauth/grant-type/passwordless/otp',
          realm: 'email',
          username: 'the@email.com',
          otp: '123456',
          clientID: '...',
          responseType: 'id_token',
          redirectUri: 'http://page.com/callback',
          state: 'randomState',
          nonce: 'randomNonce'
        };
        sinon
          .stub(CrossOriginAuthentication.prototype, 'login')
          .callsFake(function (options, cb) {
            expect(options).to.be.eql(expectedOptions);
            expect(cb()).to.be('cb');
            done();
          });

        this.auth0.passwordlessLogin(
          {
            connection: 'email',
            email: 'the@email.com',
            verificationCode: '123456'
          },
          function (err, data) {
            return 'cb';
          }
        );
      });
      it('should pass through the onRedirecting hook', function (done) {
        var onRedirecting = () => {};

        var expectedOptions = {
          credentialType: 'http://auth0.com/oauth/grant-type/passwordless/otp',
          realm: 'email',
          username: 'the@email.com',
          otp: '123456',
          clientID: '...',
          responseType: 'id_token',
          redirectUri: 'http://page.com/callback',
          state: 'randomState',
          nonce: 'randomNonce',
          onRedirecting
        };

        sinon
          .stub(CrossOriginAuthentication.prototype, 'login')
          .callsFake(function (options, cb) {
            expect(options).to.be.eql(expectedOptions);
            expect(cb()).to.be('cb');
            done();
          });

        this.auth0.passwordlessLogin(
          {
            connection: 'email',
            email: 'the@email.com',
            verificationCode: '123456',
            onRedirecting
          },
          function (err, data) {
            return 'cb';
          }
        );
      });
    });
    context('when inside of the universal login page', function () {
      beforeEach(function () {
        sinon.stub(windowHelper, 'getWindow').callsFake(function () {
          return {
            location: {
              host: 'me.auth0.com'
            }
          };
        });
      });

      afterEach(function () {
        windowHelper.getWindow.restore();
      });
      it('should call `webauth.passwordlessVerify` with phoneNumber', function (done) {
        var expectedOptions = {
          clientID: '...',
          responseType: 'id_token',
          redirectUri: 'http://page.com/callback',
          connection: 'sms',
          phoneNumber: '+55165134',
          verificationCode: '123456',
          state: 'randomState',
          nonce: 'randomNonce'
        };
        sinon
          .stub(this.auth0, 'passwordlessVerify')
          .callsFake(function (options, cb) {
            expect(options).to.be.eql(expectedOptions);
            expect(cb()).to.be('cb');
            done();
          });

        this.auth0.passwordlessLogin(
          {
            connection: 'sms',
            phoneNumber: '+55165134',
            verificationCode: '123456'
          },
          function (err, data) {
            return 'cb';
          }
        );
      });
      it('should call `webauth.passwordlessVerify` with email', function (done) {
        var expectedOptions = {
          clientID: '...',
          responseType: 'id_token',
          redirectUri: 'http://page.com/callback',
          connection: 'email',
          email: 'the@email.com',
          verificationCode: '123456',
          state: 'randomState',
          nonce: 'randomNonce'
        };
        sinon
          .stub(this.auth0, 'passwordlessVerify')
          .callsFake(function (options, cb) {
            expect(options).to.be.eql(expectedOptions);
            expect(cb()).to.be('cb');
            done();
          });

        this.auth0.passwordlessLogin(
          {
            connection: 'email',
            email: 'the@email.com',
            verificationCode: '123456'
          },
          function (err, data) {
            return 'cb';
          }
        );
      });
    });
  });

  context('passwordlessVerify', function () {
    beforeEach(function () {
      this.auth0 = new WebAuth({
        domain: 'me.auth0.com',
        clientID: '...',
        redirectUri: 'http://page.com/callback',
        responseType: 'code',
        _sendTelemetry: false
      });
    });
    afterEach(function () {
      TransactionManager.prototype.process.restore();
      this.auth0.client.passwordless.verify.restore();
    });
    it('should validate params', function () {
      this.auth0 = new WebAuth({
        domain: 'me.auth0.com',
        clientID: '...',
        redirectUri: 'http://page.com/callback',
        responseType: undefined,
        _sendTelemetry: false
      });
      sinon
        .stub(this.auth0.client.passwordless, 'verify')
        .callsFake(function () {});
      sinon.spy(TransactionManager.prototype, 'process');
      expect(() => this.auth0.passwordlessVerify({})).to.throwError(
        /responseType option is required/
      );
    });
    it('should call `transactionManager.process` with merged params', function () {
      sinon
        .stub(this.auth0.client.passwordless, 'verify')
        .callsFake(function () {});
      sinon.spy(TransactionManager.prototype, 'process');
      var expectedOptions = {
        clientID: '...',
        responseType: 'code',
        redirectUri: 'http://page.com/callback',
        connection: 'sms',
        phoneNumber: '+55165134',
        verificationCode: '123456',
        state: 'randomState'
      };

      this.auth0.passwordlessVerify(
        {
          connection: 'sms',
          phoneNumber: '+55165134',
          verificationCode: '123456'
        },
        function (err, data) {
          return 'cb';
        }
      );
      var mock = TransactionManager.prototype.process;
      expect(mock.calledOnce).to.be(true);
      expect(mock.firstCall.args[0]).to.be.eql(expectedOptions);
    });
    it('should call `passwordless.verify` with params from transactionManager', function () {
      var expectedOptions = {
        from: 'transactionManager'
      };
      var mockVerify = sinon
        .stub(this.auth0.client.passwordless, 'verify')
        .callsFake(function () {});
      sinon
        .stub(TransactionManager.prototype, 'process')
        .callsFake(function () {
          return expectedOptions;
        });

      this.auth0.passwordlessVerify({}, function (err, data) {
        return 'cb';
      });
      expect(mockVerify.calledOnce).to.be(true);
      expect(mockVerify.firstCall.args[0]).to.be.eql(expectedOptions);
    });
    it('should call callback with error', function (done) {
      var expectedError = new Error('some error');
      sinon
        .stub(this.auth0.client.passwordless, 'verify')
        .callsFake(function (params, cb) {
          cb(expectedError);
        });
      sinon
        .stub(TransactionManager.prototype, 'process')
        .callsFake(function () {});

      this.auth0.passwordlessVerify({}, function (err, data) {
        expect(err).to.be.eql(expectedError);
        done();
      });
    });
    it('should windowHelper.redirect on success', function (done) {
      var expectedUrl = 'https://verify-url.example.com';

      sinon
        .stub(this.auth0.client.passwordless, 'buildVerifyUrl')
        .callsFake(function () {
          return expectedUrl;
        });

      sinon
        .stub(this.auth0.client.passwordless, 'verify')
        .callsFake(function (params, cb) {
          cb(null);
        });

      sinon
        .stub(TransactionManager.prototype, 'process')
        .callsFake(function () {});

      sinon.stub(windowHelper, 'redirect').callsFake(function (url) {
        expect(url).to.be(expectedUrl);
        done();
      });

      this.auth0.passwordlessVerify({});

      windowHelper.redirect.restore();
      this.auth0.client.passwordless.buildVerifyUrl.restore();
    });
    it('should call onRedirecting hook if specified', function (done) {
      var expectedUrl = 'https://verify-url.example.com';

      sinon
        .stub(this.auth0.client.passwordless, 'buildVerifyUrl')
        .callsFake(function () {
          return expectedUrl;
        });

      sinon
        .stub(this.auth0.client.passwordless, 'verify')
        .callsFake(function (params, cb) {
          cb(null);
        });

      sinon
        .stub(TransactionManager.prototype, 'process')
        .callsFake(function () {});

      sinon.stub(windowHelper, 'redirect').callsFake(function (url) {
        expect(url).to.be(expectedUrl);
      });

      this.auth0.passwordlessVerify({
        onRedirecting: function (cb) {
          cb();
          expect(windowHelper.redirect.getCall(0)).to.be.ok();
          done();
        }
      });

      windowHelper.redirect.restore();
      this.auth0.client.passwordless.buildVerifyUrl.restore();
    });
  });

  context('signup', function () {
    before(function () {
      this.auth0 = new WebAuth({
        domain: 'me.auth0.com',
        clientID: '...',
        redirectUri: 'http://page.com/callback',
        responseType: 'token',
        _sendTelemetry: false
      });
    });

    afterEach(function () {
      request.post.restore();
    });

    it('should call db-connection signup with all the options', function (done) {
      sinon.stub(request, 'post').callsFake(function (url) {
        if (url === 'https://me.auth0.com/oauth/token') {
          return new RequestMock({
            body: {
              client_id: '...',
              realm: 'the_connection',
              grant_type: 'http://auth0.com/oauth/grant-type/password-realm',
              username: 'me@example.com',
              password: '123456',
              scope: 'openid'
            },
            headers: {
              'Content-Type': 'application/json'
            },
            cb: function (cb) {
              cb(null, {
                body: {
                  token_type: 'Bearer',
                  expires_in: 36000,
                  id_token: 'eyJ...'
                }
              });
            }
          });
        }

        if (url === 'https://me.auth0.com/dbconnections/signup') {
          return new RequestMock({
            body: {
              client_id: '...',
              connection: 'the_connection',
              email: 'me@example.com',
              password: '123456'
            },
            headers: {
              'Content-Type': 'application/json'
            },
            cb: function (cb) {
              cb(null, {
                body: {
                  _id: '...',
                  email_verified: false,
                  email: 'me@example.com'
                }
              });
            }
          });
        }

        throw new Error('Invalid url in request post stub');
      });

      this.auth0.signupAndAuthorize(
        {
          connection: 'the_connection',
          email: 'me@example.com',
          password: '123456',
          scope: 'openid'
        },
        function (err, data) {
          done();
        }
      );
    });

    it('should propagate signup errors', function (done) {
      sinon.stub(request, 'post').callsFake(function (url) {
        expect(url).to.be('https://me.auth0.com/dbconnections/signup');

        return new RequestMock({
          body: {
            client_id: '...',
            connection: 'the_connection',
            email: 'me@example.com',
            password: '123456'
          },
          headers: {
            'Content-Type': 'application/json'
          },
          cb: function (cb) {
            cb({
              response: {
                statusCode: 400,
                body: {
                  code: 'user_exists',
                  description: 'The user already exists.'
                }
              }
            });
          }
        });
      });

      this.auth0.signupAndAuthorize(
        {
          connection: 'the_connection',
          email: 'me@example.com',
          password: '123456',
          scope: 'openid'
        },
        function (err, data) {
          expect(data).to.be(undefined);
          expect(err).to.eql({
            original: {
              response: {
                statusCode: 400,
                body: {
                  code: 'user_exists',
                  description: 'The user already exists.'
                }
              }
            },
            code: 'user_exists',
            description: 'The user already exists.',
            statusCode: 400
          });
          done();
        }
      );
    });
  });

  context('login', function () {
    context('when outside of the universal login page', function () {
      before(function () {
        this.auth0 = new WebAuth({
          domain: 'me.auth0.com',
          clientID: '...',
          redirectUri: 'http://page.com/callback',
          responseType: 'token',
          _sendTelemetry: false
        });
      });
      beforeEach(function () {
        sinon.stub(windowHelper, 'getWindow').callsFake(function () {
          return {
            location: {
              host: 'other-domain.auth0.com'
            }
          };
        });
      });

      afterEach(function () {
        windowHelper.getWindow.restore();
        CrossOriginAuthentication.prototype.login.restore();
      });

      it('should call CrossOriginAuthentication.login', function (done) {
        var expectedOptions = {
          clientID: '...',
          responseType: 'token',
          redirectUri: 'http://page.com/callback',
          foo: 'bar',
          state: 'randomState'
        };
        sinon
          .stub(CrossOriginAuthentication.prototype, 'login')
          .callsFake(function (options, cb) {
            expect(options).to.be.eql(expectedOptions);
            expect(cb()).to.be('cb');
            done();
          });
        this.auth0.login(expectedOptions, function () {
          return 'cb';
        });
      });
    });
    context('when inside of the universal login page', function () {
      before(function () {
        this.auth0 = new WebAuth({
          domain: 'me.auth0.com',
          clientID: '...',
          redirectUri: 'http://page.com/callback',
          responseType: 'token',
          _sendTelemetry: false
        });
      });
      beforeEach(function () {
        sinon.stub(windowHelper, 'getWindow').callsFake(function () {
          return {
            location: {
              host: 'me.auth0.com'
            }
          };
        });
      });
      afterEach(function () {
        windowHelper.getWindow.restore();
      });
      it('calls _hostedPages.login mapping the connection parameter', function (done) {
        var expectedOptions = {
          clientID: '...',
          responseType: 'token',
          redirectUri: 'http://page.com/callback',
          state: 'randomState',
          connection: 'bar'
        };
        sinon
          .stub(HostedPages.prototype, 'login')
          .callsFake(function (options, cb) {
            expect(options).to.be.eql(expectedOptions);
            expect(cb()).to.be('cb');
            done();
          });
        this.auth0.login({ realm: 'bar' }, function () {
          return 'cb';
        });
      });
    });
  });

  context('cross origin callbacks', function () {
    before(function () {
      this.auth0 = new WebAuth({
        domain: 'me.auth0.com',
        clientID: '...',
        redirectUri: 'http://page.com/callback',
        responseType: 'token',
        _sendTelemetry: false
      });
    });

    afterEach(function () {
      CrossOriginAuthentication.prototype.callback.restore();
    });
    it('should call callback with deprecated method `crossOriginAuthenticationCallback`', function (done) {
      sinon
        .stub(CrossOriginAuthentication.prototype, 'callback')
        .callsFake(done);
      this.auth0.crossOriginAuthenticationCallback();
    });
    it('should call callback', function (done) {
      sinon
        .stub(CrossOriginAuthentication.prototype, 'callback')
        .callsFake(done);
      this.auth0.crossOriginVerification();
    });
  });

  context('checkSession', function () {
    beforeEach(function () {
      this.auth0 = new WebAuth({
        domain: 'me.auth0.com',
        clientID: '...',
        redirectUri: 'http://page.com/callback',
        responseType: 'token',
        _sendTelemetry: false
      });
      sinon
        .stub(TransactionManager.prototype, 'process')
        .callsFake(function (params) {
          return Object.assign({}, params, { from: 'transaction-manager' });
        });
      sinon
        .stub(TransactionManager.prototype, 'clearTransaction')
        .callsFake(function () {});
      sinon.stub(windowHelper, 'getOrigin').callsFake(function () {
        return 'https://test-origin.com';
      });
      sinon.stub(objectHelper, 'getOriginFromUrl').callsFake(function () {
        return 'https://test-origin.com';
      });
    });
    afterEach(function () {
      TransactionManager.prototype.process.restore();
      TransactionManager.prototype.clearTransaction.restore();
      if (IframeHandler.prototype.init.restore) {
        IframeHandler.prototype.init.restore();
      }
      if (WebAuth.prototype.validateAuthenticationResponse.restore) {
        WebAuth.prototype.validateAuthenticationResponse.restore();
      }
      if (windowHelper.getWindow.restore) {
        windowHelper.getWindow.restore();
      }
      if (Warn.prototype.warning.restore) {
        Warn.prototype.warning.restore();
      }
      windowHelper.getOrigin.restore();
      objectHelper.getOriginFromUrl.restore();
    });
    it('throws an error if responseType is code', function () {
      this.auth0.checkSession({ responseType: 'code' }, function (err) {
        expect(err).to.be.eql({
          error: 'error',
          error_description: "responseType can't be `code`"
        });
      });
    });
    it('throws an error if redirectUri is empty', function () {
      this.auth0.checkSession({ redirectUri: '' }, function (err) {
        expect(err).to.be.eql({
          error: 'error',
          error_description: "redirectUri can't be empty"
        });
      });
    });
    it('does not throw an origin_mismatch error if redirectUri is empty', function () {
      objectHelper.getOriginFromUrl.restore();
      sinon.stub(objectHelper, 'getOriginFromUrl').callsFake(function () {
        return undefined;
      });
      sinon.stub(IframeHandler.prototype, 'init').callsFake(function () {});

      this.auth0.checkSession({}, function (err) {
        expect(err).to.be.eql(undefined);
      });
    });
    it('throws an error if there is an origin mismatch between current window and redirectUri', function () {
      objectHelper.getOriginFromUrl.restore();
      sinon.stub(objectHelper, 'getOriginFromUrl').callsFake(function () {
        return 'some-other-origin';
      });
      this.auth0.checkSession({}, function (err) {
        expect(err).to.be.eql({
          original: {
            error: 'origin_mismatch',
            error_description:
              "The redirectUri's origin (some-other-origin) should match the window's origin (https://test-origin.com)."
          },
          code: 'origin_mismatch',
          description:
            "The redirectUri's origin (some-other-origin) should match the window's origin (https://test-origin.com).",
          error: 'origin_mismatch',
          error_description:
            "The redirectUri's origin (some-other-origin) should match the window's origin (https://test-origin.com)."
        });
      });
    });
    it('inits IframeHandler with correct params', function (done) {
      sinon.stub(IframeHandler.prototype, 'init').callsFake(function () {
        expect(this.url).to.be(
          'https://me.auth0.com/authorize?client_id=...&response_type=token&redirect_uri=http%3A%2F%2Fpage.com%2Fcallback&from=transaction-manager&response_mode=web_message&prompt=none'
        );
        expect(this.eventListenerType).to.be('message');
        expect(this.timeout).to.be(60000);
        done();
      });
      this.auth0.checkSession({}, function (err, data) {});
    });
    it('uses custom timeout when provided', function (done) {
      var timeout = 1;
      sinon.stub(IframeHandler.prototype, 'init').callsFake(function () {
        expect(this.timeout).to.be(timeout);
        done();
      });
      this.auth0.checkSession(
        {
          timeout: timeout
        },
        function (err, data) {}
      );
    });
    it('eventValidator validates the event data type is `authorization_response` and the state matches the transaction state', function (done) {
      sinon.stub(IframeHandler.prototype, 'init').callsFake(function () {
        var getEvent = function (type, state) {
          return {
            event: { data: { type: type, response: { state: state } } }
          };
        };
        expect(this.eventValidator.isValid(getEvent('wrong', 'wrong'))).to.be(
          false
        );
        expect(
          this.eventValidator.isValid(
            getEvent('authorization_response', 'wrong')
          )
        ).to.be(false);
        expect(this.eventValidator.isValid(getEvent('wrong', '123'))).to.be(
          false
        );
        expect(
          this.eventValidator.isValid(getEvent('authorization_response', '123'))
        ).to.be(true);
        done();
      });
      this.auth0.checkSession({ state: '123' }, function (err, data) {});
    });
    it('eventValidator gracefully handles null data object', function (done) {
      sinon.stub(IframeHandler.prototype, 'init').callsFake(function () {
        expect(this.eventValidator.isValid({ event: {} })).to.be(false);
        done();
      });
      this.auth0.checkSession({ state: '123' }, function () {});
    });
    it('timeoutCallback calls callback with error response', function (done) {
      sinon.stub(IframeHandler.prototype, 'init').callsFake(function () {
        this.timeoutCallback();
      });
      this.auth0.checkSession({ state: 'foobar' }, function (err, data) {
        expect(err).to.be.eql({
          original: {
            error: 'timeout',
            error_description:
              'Timeout during executing web_message communication'
          },
          code: 'timeout',
          description: 'Timeout during executing web_message communication',
          error: 'timeout',
          error_description:
            'Timeout during executing web_message communication'
        });
        done();
      });
    });
    it('callback handles error response', function (done) {
      var errorResponse = {
        error: 'the-error',
        error_description: 'error description',
        somethingElse: 'foobar'
      };
      sinon.stub(IframeHandler.prototype, 'init').callsFake(function () {
        this.callback({ event: { data: { response: errorResponse } } });
      });
      this.auth0.checkSession({}, function (err, data) {
        expect(err).to.be.eql({
          original: {
            error: 'the-error',
            error_description: 'error description'
          },
          code: 'the-error',
          description: 'error description',
          error: 'the-error',
          error_description: 'error description'
        });
        done();
      });
    });
    it('callback clears transaction on error response', function (done) {
      var errorResponse = {
        error: 'the-error',
        error_description: 'error description',
        state: 'foobar'
      };
      sinon.stub(IframeHandler.prototype, 'init').callsFake(function () {
        this.callback({ event: { data: { response: errorResponse } } });
      });
      this.auth0.checkSession({}, function (err, data) {
        expect(
          TransactionManager.prototype.clearTransaction.firstCall.args[0]
        ).to.be(errorResponse.state);
        done();
      });
    });
    it('callback clears transaction on timeout', function (done) {
      sinon.stub(IframeHandler.prototype, 'init').callsFake(function () {
        this.timeoutCallback();
      });
      this.auth0.checkSession({ state: 'foobar' }, function (err, data) {
        expect(
          TransactionManager.prototype.clearTransaction.firstCall.args[0]
        ).to.be('foobar');
        done();
      });
    });
    it('callback writes to console when consent_required + hostname===localhost', function (done) {
      var errorResponse = {
        error: 'consent_required'
      };
      sinon.stub(IframeHandler.prototype, 'init').callsFake(function () {
        this.callback({ event: { data: { response: errorResponse } } });
      });
      sinon.stub(windowHelper, 'getWindow').callsFake(function () {
        return {
          location: {
            hostname: 'localhost'
          }
        };
      });
      var warnings = [];
      sinon.stub(Warn.prototype, 'warning').callsFake(function (e) {
        warnings.push(e);
      });
      this.auth0.checkSession({}, function () {
        expect(warnings[1]).to.be(
          "Consent Required. Consent can't be skipped on localhost. Read more here: https://auth0.com/docs/api-auth/user-consent#skipping-consent-for-first-party-clients"
        );
        done();
      });
    });
    it('callback handles success response', function (done) {
      var response = { access_token: 'foobar' };
      sinon
        .stub(WebAuth.prototype, 'validateAuthenticationResponse')
        .callsFake(function (options, parsedHash, cb) {
          expect(options).to.be.eql({
            clientID: '...',
            responseType: 'token',
            redirectUri: 'http://page.com/callback',
            from: 'transaction-manager',
            responseMode: 'web_message',
            prompt: 'none'
          });
          expect(parsedHash).to.be.eql(response);
          cb(null, {
            accessToken: response.access_token
          });
        });
      sinon.stub(IframeHandler.prototype, 'init').callsFake(function () {
        this.callback({ event: { data: { response: response } } });
      });
      this.auth0.checkSession({}, function (err, data) {
        expect(err).to.be(null);
        expect(data).to.be.eql({ accessToken: 'foobar' });
        done();
      });
    });
    it('callback handles success response without changing idTokenPayload casing', function (done) {
      var response = {
        access_token: 'foobar',
        idTokenPayload: {
          email_verified: false
        }
      };
      sinon
        .stub(WebAuth.prototype, 'validateAuthenticationResponse')
        .callsFake(function (options, parsedHash, cb) {
          cb(null, {
            accessToken: response.access_token,
            idTokenPayload: response.idTokenPayload
          });
        });
      sinon.stub(IframeHandler.prototype, 'init').callsFake(function () {
        this.callback({ event: { data: { response: response } } });
      });
      this.auth0.checkSession({}, function (err, data) {
        expect(err).to.be(null);
        expect(data).to.be.eql({
          accessToken: 'foobar',
          idTokenPayload: response.idTokenPayload
        });
        done();
      });
    });
  });

  context('validateToken', function () {
    it('should send through a default leeway', function (done) {
      var idTokenVerifierMock = function (opts) {
        expect(opts.leeway).to.be(60);
        done();
      };

      var { default: ProxiedWebAuth } = proxyquire('../../src/web-auth', {
        'idtoken-verifier': idTokenVerifierMock
      });

      var webAuth = new ProxiedWebAuth({
        domain: 'brucke.auth0.com',
        redirectUri: 'http://example.com/callback',
        clientID: 'k5u3o2fiAA8XweXEEX604KCwCjzjtMU6',
        responseType: 'token id_token'
      });

      webAuth.validateToken('token', 'nonce', function () {});
    });

    it('should accept a specified leeway', function (done) {
      var idTokenVerifierMock = function (opts) {
        expect(opts.leeway).to.be(25);
        done();
      };

      var { default: ProxiedWebAuth } = proxyquire('../../src/web-auth', {
        'idtoken-verifier': idTokenVerifierMock
      });

      var webAuth = new ProxiedWebAuth({
        domain: 'brucke.auth0.com',
        redirectUri: 'http://example.com/callback',
        clientID: 'k5u3o2fiAA8XweXEEX604KCwCjzjtMU6',
        responseType: 'token id_token',
        leeway: 25
      });

      webAuth.validateToken('token', 'nonce', function () {});
    });

    it('should use undefined jwksURI, allowing it to be overwritten later', function (done) {
      var idTokenVerifierMock = function (opts) {
        expect(opts.jwksURI).to.be(undefined);
        done();
      };
      var { default: ProxiedWebAuth } = proxyquire('../../src/web-auth', {
        'idtoken-verifier': idTokenVerifierMock
      });
      var webAuth = new ProxiedWebAuth({
        domain: 'brucke.auth0.com',
        redirectUri: 'http://example.com/callback',
        clientID: 'k5u3o2fiAA8XweXEEX604KCwCjzjtMU6',
        responseType: 'token id_token'
      });

      webAuth.validateToken('token', 'nonce', function () {});
    });

    it('should use correct jwksURI when overriden', function (done) {
      var idTokenVerifierMock = function (opts) {
        expect(opts.jwksURI).to.be('jwks_uri');
        done();
      };
      var { default: ProxiedWebAuth } = proxyquire('../../src/web-auth', {
        'idtoken-verifier': idTokenVerifierMock
      });
      var webAuth = new ProxiedWebAuth({
        domain: 'brucke.auth0.com',
        redirectUri: 'http://example.com/callback',
        clientID: 'k5u3o2fiAA8XweXEEX604KCwCjzjtMU6',
        responseType: 'token id_token',
        overrides: {
          __jwks_uri: 'jwks_uri'
        }
      });
      webAuth.validateToken('token', 'nonce', function () {});
    });
  });

  context('captcha rendering', function () {
    it('should call the captcha rendering function', function () {
      const element = {};
      const options = {};
      const captcha = {};
      const renderStub = sinon.stub().returns(captcha);
      const callback = function () {};

      var { default: ProxiedWebAuth } = proxyquire('../../src/web-auth', {
        './captcha': { default: { render: renderStub } }
      });

      var webAuth = new ProxiedWebAuth({
        domain: 'brucke.auth0.com',
        redirectUri: 'http://example.com/callback',
        clientID: 'k5u3o2fiAA8XweXEEX604KCwCjzjtMU6'
      });

      const result = webAuth.renderCaptcha(element, options, callback);

      expect(renderStub.called).to.be.ok();
      expect(renderStub.args[0][0]).to.be.equal(webAuth.client);
      expect(renderStub.args[0][1]).to.be.equal(element);
      expect(renderStub.args[0][2]).to.be.equal(options);
      expect(renderStub.args[0][3]).to.be.equal(callback);
      expect(result).to.equal(captcha);
    });
  });

  context('passwordless captcha rendering', function () {
    it('should call the captcha rendering function', function () {
      const element = {};
      const options = {};
      const captcha = {};
      const renderStub = sinon.stub().returns(captcha);
      const callback = function () {};

      var { default: ProxiedWebAuth } = proxyquire('../../src/web-auth', {
        './captcha': { default: { renderPasswordless: renderStub } }
      });

      var webAuth = new ProxiedWebAuth({
        domain: 'brucke.auth0.com',
        redirectUri: 'http://example.com/callback',
        clientID: 'k5u3o2fiAA8XweXEEX604KCwCjzjtMU6'
      });

      const result = webAuth.renderPasswordlessCaptcha(
        element,
        options,
        callback
      );

      expect(renderStub.called).to.be.ok();
      expect(renderStub.args[0][0]).to.be.equal(webAuth.client);
      expect(renderStub.args[0][1]).to.be.equal(element);
      expect(renderStub.args[0][2]).to.be.equal(options);
      expect(renderStub.args[0][3]).to.be.equal(callback);
      expect(result).to.equal(captcha);
    });
  });
});
