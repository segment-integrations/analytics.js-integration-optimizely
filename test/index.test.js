'use strict';

var Analytics = require('@segment/analytics.js-core').constructor;
var sandbox = require('@segment/clear-env');
var tester = require('@segment/analytics.js-integration-tester');
var Optimizely = require('../lib/');
var tick = require('next-tick');

/**
 * Test account: han@segment.com
 *
 * Docs for Optimizely data object: https://developers.optimizely.com/javascript/personalization/index.html#reading-data-and-state
 */

var mockOptimizelyClassicDataObject = function() {
  // Classic
  window.optimizely.data = {
    experiments: {
      0: { name: 'Test' },
      1: { name: 'MultiVariate Test' },
      2: { name: 'Inactive Test' },
      11: { name: 'Redirect Test' }
    },
    variations: {
      22: { name: 'Redirect Variation', code: '' },
      123: { name: 'Variation #123', code: '' },
      789: { name: 'Var 789', code: '' },
      44: { name: 'Var 44', code: '' }
    },
    sections: { 1: { name: 'Section 1', variation_ids: [123, 22, 789] } },
    state: {
      activeExperiments: [0, 11],
      variationNamesMap: {
        0: 'Variation #123',
        1: 'Variation #123, Redirect Variation, Var 789', // this is the data format
        2: 'Inactive Variation',
        11: 'Redirect Variation'
      },
      variationIdsMap: { 0: [123], 1: [123, 22, 789], 11: [22], 2: [44] },
      redirectExperiment: {
        variationId: 22,
        experimentId: 11,
        referrer: 'google.com'
      }
    }
  };
};

// Optimizely X
var mockOptimizelyXDataObject = function() {
  // remove Classic data object
  delete window.optimizely.data;

  window.optimizely.newMockData = {
    2347102720: {
      audiences: [
        {
          name: 'Middle Class',
          id: '7100568438'
        }
      ],
      campaignName: 'Get Rich or Die Tryin',
      id: '2347102720',
      experiment: {
        id: '7522212694',
        name: 'Wells Fargo Scam'
      },
      variation: {
        id: '7551111120',
        name: 'Variation Corruption #1884'
      },
      // these are returned by real Optimizely API but will not be send to integrations
      isActive: false,
      isInCampaignHoldback: false,
      reason: undefined,
      visitorRedirected: true
    },
    7547101713: {
      audiences: [
        {
          name: 'Trust Tree',
          id: '7527565438'
        }
      ],
      campaignName: 'URF',
      id: '7547101713',
      experiment: {
        id: '7547682694',
        name: 'Worlds Group Stage'
      },
      variation: {
        id: '7557950020',
        name: 'Variation #1'
      },
      // these are returned by real Optimizely API but will not be send to integrations
      isActive: true,
      isInCampaignHoldback: false,
      reason: undefined,
      visitorRedirected: false
    },
    2542102702: {
      audiences: [
        {
          name: 'Penthouse 6',
          id: '8888222438'
        }
      ],
      campaignName: 'Millionaire Pact',
      id: '7222777766',
      experiment: {
        id: '1111182111',
        name: 'Coding Bootcamp'
      },
      variation: {
        id: '7333333333',
        name: 'Variation DBC'
      },
      // these are returned by real Optimizely API but will not be send to integrations
      isActive: true,
      isInCampaignHoldback: false,
      reason: undefined,
      visitorRedirected: false
    }
  };
  // Optimizely init snippet uses new API methods below to access data rather than the global optimizely.data object
  window.optimizely.get = function() {
    return {
      getCampaignStates: function(options) {
        if (!('isActive' in options)) return window.optimizely.newMockData;
        // returns all campaigns with option to return just active ones (which is what we do in the snippet)
        var ret = {};
        for (var campaign in window.optimizely.newMockData) {
          if (window.optimizely.newMockData[campaign].isActive === options.isActive) {
            ret[campaign] = window.optimizely.newMockData[campaign];
          }
        }
        return ret;
      },
      getRedirectInfo: function() {
        var campaigns = this.getCampaignStates({ isActive: true });
        for (var id in campaigns) {
          if (campaigns[id].visitorRedirected) return { referrer: 'barstools.com' };
        }
        return;
      }
    };
  };
};

var mockBothOptimizelyDataObjects = function() {
  mockOptimizelyXDataObject();
  mockOptimizelyClassicDataObject();
};

describe('Optimizely', function() {
  var analytics;
  var optimizely;
  var options = {
    listen: true,
    variations: false,
    nonInteraction: false
  };

  beforeEach(function() {
    analytics = new Analytics();
    optimizely = new Optimizely(options);
    analytics.use(Optimizely);
    analytics.use(tester);
    analytics.add(optimizely);
    window.optimizely = [];
  });

  afterEach(function() {
    analytics.restore();
    analytics.reset();
    optimizely.reset();
    sandbox();
  });

  describe('before loading', function() {
    beforeEach(function() {
      analytics.stub(Optimizely, 'initOptimizelyIntegration', Optimizely.initOptimizelyIntegration); // Reference to constructor intentionally
      analytics.stub(optimizely, 'load');
      analytics.stub(optimizely, 'sendClassicDataToSegment');
      analytics.stub(optimizely, 'sendNewDataToSegment');
      analytics.stub(optimizely, 'setEffectiveReferrer');
    });

    describe('#initialize', function() {
      beforeEach(function(done) {
        analytics.stub(window.optimizely, 'push');
        analytics.once('ready', done);
        analytics.initialize();
        analytics.page();
      });

      it('should call initOptimizelyIntegration', function(done) {
        tick(function() {
          analytics.called(Optimizely.initOptimizelyIntegration);
          done();
        });
      });

      it('should flag source of integration', function() {
        analytics.called(window.optimizely.push, {
          type: 'integration',
          OAuthClientId: '5360906403'
        });
      });
    });

    describe('#initOptimizelyIntegration', function() {
      // Testing the behavior of the Optimizely provided private init function
      // to ensure that proper callback functions were executed with expected params
      // given each of the possible Optimizely snippet you could have on the page (Classic, X, Both)
      describe('Classic', function() {
        beforeEach(function(done) {
          mockOptimizelyClassicDataObject();
          analytics.initialize();
          tick(done);
        });

        it('should call setEffectiveReferrer for redirect experiments', function() {
          analytics.called(optimizely.setEffectiveReferrer, 'google.com');
        });

        it('should call sendClassicDataToSegment for active Classic experiments', function() {
          // we have two active experiments running in the mock data object
          analytics.calledTwice(optimizely.sendClassicDataToSegment);
          analytics.deepEqual(optimizely.sendClassicDataToSegment.args[0], [{
            experiment: {
              id: '0',
              name: 'Test'
            },
            variations: [{
              id: '123',
              name: 'Variation #123'
            }],
            section: undefined
          }]);
          analytics.deepEqual(optimizely.sendClassicDataToSegment.args[1], [{
            experiment: {
              id: '11',
              name: 'Redirect Test',
              referrer: 'google.com'
            },
            variations: [{
              id: '22',
              name: 'Redirect Variation'
            }],
            section: undefined
          }]);
        });
      });

      describe('New', function() {
        beforeEach(function() {
          mockOptimizelyXDataObject();
        });

        it('should not call setEffectiveReferrer for non redirect experiments', function(done) {
          // by default mock data has no redirect experiments active
          analytics.initialize();
          tick(function() {
            analytics.didNotCall(optimizely.setEffectiveReferrer);
            done();
          });
        });

        it('should call setEffectiveReferrer for redirect experiments', function(done) {
          // enable redirect experiment
          window.optimizely.newMockData[2347102720].isActive = true;
          analytics.initialize();
          tick(function() {
            analytics.called(optimizely.setEffectiveReferrer, 'barstools.com');
            done();
          });
        });

        it('should call sendNewDataToSegment for active Optimizely X campaigns', function(done) {
          analytics.initialize();
          tick(function() {
            analytics.calledTwice(optimizely.sendNewDataToSegment);
            analytics.deepEqual(optimizely.sendNewDataToSegment.args[0], [
              {
                audiences: [
                  {
                    name: 'Penthouse 6',
                    id: '8888222438'
                  }
                ],
                campaignName: 'Millionaire Pact',
                id: '7222777766',
                experiment: {
                  id: '1111182111',
                  name: 'Coding Bootcamp'
                },
                variation: {
                  id: '7333333333',
                  name: 'Variation DBC'
                },
                isActive: true,
                isInCampaignHoldback: false,
                reason: undefined,
                visitorRedirected: false
              }
            ]);
            analytics.deepEqual(optimizely.sendNewDataToSegment.args[1], [
              {
                audiences: [
                  {
                    name: 'Trust Tree',
                    id: '7527565438'
                  }
                ],
                campaignName: 'URF',
                id: '7547101713',
                experiment: {
                  id: '7547682694',
                  name: 'Worlds Group Stage'
                },
                variation: {
                  id: '7557950020',
                  name: 'Variation #1'
                },
                isActive: true,
                isInCampaignHoldback: false,
                reason: undefined,
                visitorRedirected: false
              }
            ]);
            done();
          });
        });
      });

      describe('Both', function() {
        beforeEach(function() {
          mockBothOptimizelyDataObjects();
          analytics.initialize();
        });

        // Note: we're not testing setEffectiveReferrer here since you can only have one version
        // or the other, not both. And each one has been tested in the above unit tests

        it('should call both sendClassicDataToSegment and sendNewDataToSegment', function(done) {
          // we have two active experiments running in the mock data object for both versions
          tick(function() {
            analytics.calledTwice(optimizely.sendClassicDataToSegment);
            analytics.calledTwice(optimizely.sendNewDataToSegment);
            analytics.deepEqual(optimizely.sendClassicDataToSegment.args[0], [{
              experiment: {
                id: '0',
                name: 'Test'
              },
              variations: [{
                id: '123',
                name: 'Variation #123'
              }],
              section: undefined
            }]);
            analytics.deepEqual(optimizely.sendClassicDataToSegment.args[1], [{
              experiment: {
                id: '11',
                name: 'Redirect Test',
                referrer: 'google.com'
              },
              variations: [{
                id: '22',
                name: 'Redirect Variation'
              }],
              section: undefined
            }]);
            analytics.deepEqual(optimizely.sendNewDataToSegment.args[0], [
              {
                audiences: [
                  {
                    name: 'Penthouse 6',
                    id: '8888222438'
                  }
                ],
                campaignName: 'Millionaire Pact',
                id: '7222777766',
                experiment: {
                  id: '1111182111',
                  name: 'Coding Bootcamp'
                },
                variation: {
                  id: '7333333333',
                  name: 'Variation DBC'
                },
                isActive: true,
                isInCampaignHoldback: false,
                reason: undefined,
                visitorRedirected: false
              }
            ]);
            analytics.deepEqual(optimizely.sendNewDataToSegment.args[1], [
              {
                audiences: [
                  {
                    name: 'Trust Tree',
                    id: '7527565438'
                  }
                ],
                campaignName: 'URF',
                id: '7547101713',
                experiment: {
                  id: '7547682694',
                  name: 'Worlds Group Stage'
                },
                variation: {
                  id: '7557950020',
                  name: 'Variation #1'
                },
                isActive: true,
                isInCampaignHoldback: false,
                reason: undefined,
                visitorRedirected: false
              }
            ]);
            done();
          });
        });
      });
    });
  });

  describe('#setEffectiveReferrer', function() {
    describe('Classic', function() {
      beforeEach(function(done) {
        mockOptimizelyClassicDataObject();
        analytics.initialize();
        tick(done);
      });

      it('should set a global variable `window.optimizelyEffectiveReferrer`', function() {
        analytics.equal(window.optimizelyEffectiveReferrer, 'google.com');
      });
    });

    describe('New', function() {
      beforeEach(function() {
        mockOptimizelyXDataObject();
        // enable redirect experiment
        window.optimizely.newMockData[2347102720].isActive = true;
        analytics.initialize();
      });

      it('should set a global variable `window.optimizelyEffectiveReferrer`', function(done) {
        tick(function() {
          analytics.equal(window.optimizelyEffectiveReferrer, 'barstools.com');
          done();
        });
      });
    });

    // Again -- we're not testing for both since there is no point.
    // You can't have this function execute twice each with different referrer value
    // It will always either just call one or the other
  });

  describe.only('#sendClassicDataToSegment', function() {
    beforeEach(function() {
      mockOptimizelyClassicDataObject();
    });

    describe('#options.variations', function() {
      beforeEach(function(done) {
        optimizely.options.variations = true;
        analytics.stub(analytics, 'identify');
        analytics.initialize();
        tick(done);
      });

      it('should send each experiment via `.identify()`', function() {
        // Since we have two experiments in `window.optimizely.data.state.activeExperiments`
        // This test proves the breaking changes for the option (it used to send both experiment data in one
        // `.identify()` call)
        analytics.calledTwice(analytics.identify);
        analytics.deepEqual(analytics.identify.args[0], [{
          'Experiment: Test': 'Variation #123'
        }]);
        analytics.deepEqual(analytics.identify.args[1], [{
          'Experiment: Redirect Test': 'Redirect Variation'
        }]);
      });
    });

    describe('#options.listen', function() {
      // TODO: why is this?
      // NOTE: these tests will hang if the `.track()` or `.identify()` call's params do not match
      var optimizelyContext = {
        name: 'optimizely',
        version: '2.0.0'
      };
      beforeEach(function() {
        optimizely.options.listen = true;
        analytics.stub(analytics, 'track');
      });

      it('should send each standard active experiment data via `.track()`', function(done) {
        // activate standard experiment
        window.optimizely.data.state.activeExperiments = [0];
        analytics.initialize();
        tick(function() {
          analytics.deepEqual(analytics.track.args[0], [
            'Experiment Viewed',
            {
              experimentId: 0,
              experimentName: 'Test',
              variationId: '123',
              variationName: 'Variation #123'
            },
            { integration: optimizelyContext }
          ]);
          done();
        });
      });

      it('should send multivariate active experiment data via `.track()`', function(done) {
        // activate multivariate experiment
        window.optimizely.data.state.activeExperiments = [1];
        analytics.initialize();
        tick(function() {
          analytics.deepEqual(analytics.track.args[0], [
            'Experiment Viewed',
            {
              experimentId: 1,
              experimentName: 'MultiVariate Test',
              variationId: '123,22,789',
              variationName: 'Variation #123,Redirect Variation,Var 789',
              sectionName: 'Section 1'
            },
            { integration: optimizelyContext },
          ]);
          done();
        });
      });

      it('should send redirect active experiment data via `.track()`', function(done) {
        // activate redirect experiment
        window.optimizely.data.state.activeExperiments = [11];
        analytics.initialize();
        tick(function() {
          analytics.deepEqual(analytics.track.args[0], [
            'Experiment Viewed',
            {
              experimentId: 11,
              experimentName: 'Redirect Test',
              referrer: 'google.com',
              variationId: '22',
              variationName: 'Redirect Variation'
            },
            { integration: optimizelyContext }
          ]);
          done();
        });
      });

      it('should send Google\'s nonInteraction flag via `.track()`', function(done) {
        // flip the nonInteraction option on and activate standard experiment
        optimizely.options.nonInteraction = true;
        window.optimizely.data.state.activeExperiments = [0];
        analytics.initialize();
        tick(function() {
          analytics.deepEqual(analytics.track.args[0], [
            'Experiment Viewed',
            {
              experimentId: 0,
              experimentName: 'Test',
              variationId: '123',
              variationName: 'Variation #123',
              nonInteraction: 1
            },
            { integration: optimizelyContext }
          ]);
          done();
        });
      });

      it('should not send inactive experiments', function(done) {
        // disable all active experiments
        window.optimizely.data.state.activeExperiments = [];
        analytics.initialize();
        tick(function() {
          analytics.didNotCall(analytics.track);
          done();
        });
      });
    });
  });

  describe('#sendNewDataToSegment', function() {
    it('should send via `.identify()`');
    it('should send standard active experiment data via `.track()`');
    it('should send personalized campaign data via `.track()`');
    it('should send redirect experiment data via `.track()`');
    it('should send Google\'s nonInteraction flag via `.track()`');
    it('should not send inactive experiments');
  });

  describe.skip('after loading', function() {
    beforeEach(function(done) {
      analytics.once('ready', done);
      analytics.initialize();
      mockBothOptimizelyDataObjects();
      analytics.page();
    });

    describe('#track', function() {
      beforeEach(function() {
        analytics.stub(window.optimizely, 'push');
      });

      it('should send an event', function() {
        analytics.track('event');
        analytics.called(window.optimizely.push, ['trackEvent', 'event', {}]);
      });

      it('shouldn\'t send properties it can\'t process', function() {
        analytics.track('event', { property: true });
        analytics.called(window.optimizely.push, ['trackEvent', 'event', {}]);
      });

      it('should change revenue to cents', function() {
        analytics.track('event', { revenue: 9.99 });
        analytics.called(window.optimizely.push, ['trackEvent', 'event', {
          revenue: 999
        }]);
      });
    });

    describe('#page', function() {
      beforeEach(function() {
        analytics.stub(window.optimizely, 'push');
      });

      it('should send an event for a named page', function() {
        analytics.page('Home');
        analytics.called(window.optimizely.push, ['trackEvent', 'Viewed Home Page', {}]);
      });

      it('should send an event for a named and categorized page', function() {
        analytics.page('Blog', 'New Integration');
        analytics.called(window.optimizely.push, ['trackEvent', 'Viewed Blog New Integration Page', {}]);
      });
    });
  });
});
