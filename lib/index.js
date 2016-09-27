'use strict';

/**
 * Module dependencies.
 */

var each = require('@ndhoule/each');
var integration = require('@segment/analytics.js-integration');
var push = require('global-queue')('optimizely', { wrap: false });

/**
 * Expose `Optimizely` integration.
 */

var Optimizely = module.exports = integration('Optimizely')
  .option('trackCategorizedPages', true)
  .option('trackNamedPages', true)
  .option('variations', false)
  .option('listen', true)
  .option('nonInteraction', false);

/**
 * The name and version for this integration.
 */

var optimizelyContext = {
  name: 'optimizely',
  version: '2.0.0'
};

/**
 * Initialize.
 *
 * https://www.optimizely.com/docs/api#function-calls
 * https://jsfiddle.net/ushmw723/ <- includes optimizely snippets for capturing campaign and experiment data
 *
 * @api public
 */

Optimizely.prototype.initialize = function() {
  var self = this;
  // Flag source of integration (requested by Optimizely)
  push({
    type: 'integration',
    OAuthClientId: '5360906403'
  });
  // Initialize listeners for both Classic and New Optimizely
  initOptimizelyIntegration({
    referrerOverride: self.setEffectiveReferrer,
    sendExperimentData: self.sendClassicDataToSegment,
    sendCampaignData: self.sendNewDataToSegment
  });

  this.ready();
};

/**
 * Track. trackEvent can only send one property, revenue
 * We fall back to total if it's on the call and revenue is not
 *
 * https://www.optimizely.com/docs/api#track-event
 * http://developers.optimizely.com/javascript/reference/#api-function-calls
 *
 * @api public
 * @param {Track} track
 */

Optimizely.prototype.track = function(track) {
  var payload = {};
  var revenue = track.revenue();
  if (revenue) payload.revenue = revenue *= 100;
  push(['trackEvent', track.event(), payload]);
};

/**
 * Page.
 *
 * https://www.optimizely.com/docs/api#track-event
 *
 * @api public
 * @param {Page} page
 */

Optimizely.prototype.page = function(page) {
  var category = page.category();
  var name = page.fullName();
  var opts = this.options;

  // categorized pages
  if (category && opts.trackCategorizedPages) {
    this.track(page.track(category));
  }

  // named pages
  if (name && opts.trackNamedPages) {
    this.track(page.track(name));
  }
};

/**
 * sendClassicDataToSegment
 *
 * This function is executed for each experiment created in Classic Optimizely that is running on the page.
 *
 * @api private
 * @param {Object} experimentState: contains all information regarding experiments
 * @param {Object} experimentState.experiment: the experiment running on the page
 * @param {String} experimentState.experiment.name: name of the experiment
 * @param {String} experimentState.experiment.id: ID of the experiment
 * @param {String} experimentState.experiment.referrer: available if effective referrer if experiment is a redirect
 * @param {Array} experimentState.variations: the variations the current user on page is seeing
 * @param {String} experimentState.variations[].name: the name of the variation
 * @param {String} experimentState.variations[].id: the ID of the variation
 * @param {Object} experimentState.section: the section information for the experiment (for multivariate experiments I believe) TODO: confirm this
 */

Optimizely.prototype.sendClassicDataToSegment = function(experimentState) {
  var experiment = experimentState.experiment;
  var variations = experimentState.variations;
  var variationIds = [];
  var variationNames = [];

  // Makes concatenating easier later
  each(function(variation) {
    variationIds.push(variation.id);
    variationNames.push(variation.name);
  }, variations);


  // Send data via `.track()`
  if (this.settings.listen) {
    var props = {
      experimentId: experiment.id,
      experimentName: experiment.name
    };

    // If this was a redirect experiment this value is made available
    if (experiment.referrer) props.referrer = experiment.referrer;

    // When only one variation running:
    if (variations.length && variations.length < 2) {
      props.variationName = variations[0].name;
      props.variationId = variations[0].id;
    }

    // When there is a multivariate experiment
    if (variations.length > 1) {
      // Note: Legacy code was sending the an array holding all variation names without concatenating
      // TODO: So just like variationIds, should we concatenate the names for multivariate experiments
      // eg. 'Variation #1,My Variation 123,Variation #3' vs `Variation #1`
      // props.variationName = variationNames.join();
      props.variationName = variationNames;
      props.variationId = variationIds.join();
      props.sectionName = experimentState.section.name
    }

    // For Google's nonInteraction flag
    if (this.settings.nonInteraction) props.nonInteraction = 1;

    // Send to Segment
    this.analytics.track('Experiment Viewed', props, { integration: optimizelyContext });
  }

  // Send data via `.identify()` (not recommended!)
  if (this.settings.variations) {
    // Legacy: We never sent any experiment Id or variation Id
    // Note: The only "breaking" behavior is that now there will be an `.identify()` per active experiment
    // Legacy behavior was that we would look up all active experiments on the page after init and send one `.identify()` call
    // with all experiment/variation data as traits.
    // New behavior will call `.identify()` per active experiment with isolated experiment/variation data for that single experiment
    // TODO: deprecate this terrible feature
    var traits = {};
    traits['Experiment: ' + experiment.name] = variationNames; // TODO: should we concatenate?

    // Send to Segment
    this.analytics.identify(traits);
  }
};

/**
 * sendNewDataToSegment
 *
 * This function is called for each experiment created in New Optimizely that are running on the page.
 * New Optimizely added a dimension called "Campaigns" that encapsulate over the Experiments. So a campaign can have multiple experiments.
 * Multivariate experiments are no longer supported in New Optimizely.
 *
 * @api private
 * @param {Object} campaignState: contains all information regarding experiments and campaign
 * @param {String} campaignState.id: the ID of the campaign
 * @param {String} campaignState.campaignName: the name of the campaign
 * @param {Array} campaignState.audiences: "Audiences" the visitor is considered part of related to this campaign
 * @param {String} campaignState.audiences[].id: the id of the Audience
 * @param {String} campaignState.audiences[].name: the name of the Audience
 * @param {Object} campaignState.experiment: the experiment the visitor is seeing
 * @param {Object} campaignState.experiment.id: the id of the experiment
 * @param {Object} campaignState.experiment.name: the name of the experiment
 * @param {Object} campaignState.variation: the variation the visitor is seeing
 * @param {Object} campaignState.variation.id: the id of the variation
 * @param {Object} campaignState.variation.name: the name of the variation
 */

Optimizely.prototype.sendNewDataToSegment = function(campaignState) {
  var experiment = campaignState.experiment;
  var variation = campaignState.variation;
  var audienceIds = [];
  var audienceNames = [];

  // Makes concatenating easier later
  each(function(audience) {
    audienceIds.push(audience.id);
    audienceNames.push(audience.name);
  }, campaignState.audiences);

  // Send data via `.track()`
  if (this.settings.listen) {
    var props = {
      campaignName: campaignState.campaignName,
      campaignId: campaignState.id,
      experimentId: experiment.id,
      experimentName: experiment.name,
      variationName: variation.name,
      variationId: variation.id,
      audienceId: audienceIds.join(),
      audienceName: audienceNames.join()
    };

    // For Google's nonInteraction flag
    if (this.settings.nonInteraction) props.nonInteraction = 1;

    // Send to Segment
    this.analytics.track('Experiment Viewed', props, { integration: optimizelyContext });
  }

  // Send data via `.identify()` (not recommended!)
  if (this.settings.variations) {
    // Legacy: We never sent any experiment Id or variation Id
    // Note: The only "breaking" behavior is that now there will be an `.identify()` per active experiment
    // Legacy behavior was that we would look up all active experiments on the page after init and send one `.identify()` call
    // with all experiment/variation data as traits.
    // New behavior will call `.identify()` per active experiment with isolated experiment/variation data for that single experiment
    // TODO: deprecate this terrible feature
    var traits = {};
    traits['Experiment: ' + experiment.name] = variation.name;

    // Send to Segment
    this.analytics.identify(traits);
  }
};

/**
 * setEffectiveReferrer
 *
 * This function is called when a redirect experiment changed the effective referrer value where it is different from the `document.referrer`.
 * This is a documented caveat for any mutual customers that are using redirect experiments.
 * We will set this global variable that Segment customers can lookup and pass down in their initial `.page()` call inside
 * their Segment snippet.
 *
 * @apr private
 * @param {string} referrer
 */

Optimizely.prototype.setEffectiveReferrer = function(referrer) {
  if (referrer) return window.optimizelyEffectiveReferrer = referrer;
};

/**
 * initOptimizelyIntegration(handlers)
 *
 * This function was provided by Optimizely's Engineering team. The function below once initialized can detect which version of
 * Optimizely a customer is using and call the appropriate callback functions when an experiment runs on the page.
 * Instead of Segment looking up the experiment data, we can now just bind Segment APIs to their experiment listener/handlers!
 *
 * @api private
 * @param {Object} handlers
 * @param {Function} referrerOverride: called if the effective refferer value differs from the current `document.referrer` due to a
 * invocation of a redirect experiment on the page
 * @param {Function} sendExperimentData: called for every running experiment on the page (Classic)
 * @param {Function} sendCampaignData: called for every running campaign on the page (New)
 */

function initOptimizelyIntegration(handlers) {
  /**
   * `initClassicOptimizelyIntegration` fetches all the experiment data from the classic Optimizely client
   * and calls the functions provided in the arguments with the data that needs to
   * be used for sending information. It is recommended to leave this function as is
   * and to create your own implementation of the functions referrerOverride and
   * sendExperimentData.
   *
   * @param {Function} referrerOverride - This function is called if the effective referrer value differs from
   *   the current document.referrer value. The only argument provided is the effective referrer value.
   * @param {Function} sendExperimentData - This function is called for every running experiment on the page.
   *   The function is called with all the relevant ids and names.
   */
  var initClassicOptimizelyIntegration = function(referrerOverride, sendExperimentData) {
    var data = window.optimizely && window.optimizely.data;
    var state = data && data.state;
    if (state) {
      var activeExperiments = state.activeExperiments;
      if (state.redirectExperiment) {
        var redirectExperimentId = state.redirectExperiment.experimentId;
        var index = false;
        for (var i = 0; i < state.activeExperiments.length; i++) {
          if (state.activeExperiments[i] === redirectExperimentId) {
            index = i;
            break;
          }
        }
        if (index === -1) {
          activeExperiments.push(redirectExperimentId);
        }
        referrerOverride(state.redirectExperiment.referrer);
      }

      for (var k = 0; k < activeExperiments.length; k++) {
        var currentExperimentId = activeExperiments[k];
        var activeExperimentState = {
          experiment: {
            id: currentExperimentId,
            name: data.experiments[currentExperimentId].name
          },
          variations: [],
          /** Segment added code */
          // we need to send sectionName for multivariate experiments
          section: data.sections[currentExperimentId]
          /**/
        };

        /** Segment added code */
        // for backward compatability since we send referrer with the experiment properties
        if (state.redirectExperiment && state.redirectExperiment.referrer) {
          activeExperimentState.experiment.referrer = state.redirectExperiment.referrer;
        }
        /**/

        var variationIds = state.variationIdsMap[activeExperimentState.experiment.id];
        for (var j = 0; j < variationIds.length; j++) {
          var id = variationIds[j];
          var name = data.variations[id].name;
          activeExperimentState.variations.push({
            id: id,
            name: name
          });
        }

        sendExperimentData(activeExperimentState);
      }
    }
  };

  /**
   * This function fetches all the campaign data from the new Optimizely client
   * and calls the functions provided in the arguments with the data that needs to
   * be used for sending information. It is recommended to leave this function as is
   * and to create your own implementation of the functions referrerOverride and
   * sendCampaignData.
   *
   * @param {Function} referrerOverride - This function is called if the effective referrer value differs from
   *   the current document.referrer value. The only argument provided is the effective referrer value.
   * @param {Function} sendCampaignData - This function is called for every running campaign on the page.
   *   The function is called with the campaignState for the activated campaign
   */
  var initNewOptimizelyIntegration = function(referrerOverride, sendCampaignData) {
    var newActiveCampaign = function(id) {
      var state = window.optimizely.get && window.optimizely.get('state');
      if (state) {
        var activeCampaigns = state.getCampaignStates({
          isActive: true
        });
        var campaignState = activeCampaigns[id];
        sendCampaignData(campaignState);
      }
    };

    var checkReferrer = function() {
      var state = window.optimizely.get && window.optimizely.get('state');
      if (state) {
        var referrer = state.getRedirectInfo() && state.getRedirectInfo().referrer;

        if (referrer) {
          referrerOverride(referrer);
        }
      }
    };

    /**
     * At any moment, a new campaign can be activated (manual or conditional activation).
     * This function registers a listener that listens to newly activated campaigns and
     * handles them.
     */
    var registerFutureActiveCampaigns = function() {
      window.optimizely = window.optimizely || [];
      window.optimizely.push({
        type: 'addListener',
        filter: {
          type: 'lifecycle',
          name: 'campaignDecided'
        },
        handler: function(event) {
          var id = event.data.campaign.id;
          newActiveCampaign(id);
        }
      });
    };

    /**
     * If this code is running after Optimizely on the page, there might already be
     * some campaigns active. This function makes sure all those campaigns are
     * handled.
     */
    var registerCurrentlyActiveCampaigns = function() {
      window.optimizely = window.optimizely || [];
      var state = window.optimizely.get && window.optimizely.get('state');
      if (state) {
        checkReferrer();
        var activeCampaigns = state.getCampaignStates({
          isActive: true
        });
        for (var id in activeCampaigns) {
          if ({}.hasOwnProperty.call(activeCampaigns, id)) {
            newActiveCampaign(id);
          }
        }
      } else {
        window.optimizely.push({
          type: 'addListener',
          filter: {
            type: 'lifecycle',
            name: 'initialized'
          },
          handler: function() {
            checkReferrer();
          }
        });
      }
    };
    registerCurrentlyActiveCampaigns();
    registerFutureActiveCampaigns();
  };

  initClassicOptimizelyIntegration(handlers.referrerOverride, handlers.sendExperimentData);
  initNewOptimizelyIntegration(handlers.referrerOverride, handlers.sendCampaignData);
}

