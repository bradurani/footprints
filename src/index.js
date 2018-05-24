import { factory, detectPrng } from 'ulid';

var prng = detectPrng(true); // pass `true` to allow insecure
var ulid = factory(prng);

/* lint for semicolons */

var LIB_NAME = 'Footprints';
var DEFAULT_INTERVAL_WAIT = 5000;

export function init(footprints){
  if(footprints.initialized){
    console.error('Footprints already initialized');
    return;
  }
  footprints.initialized = true;

  footprints.state = {
    basePayload: {},
    inputQueue: footprints.q || [],
    outputQueue: []
  };

  footprints.noop = function(){};

  //utlities methods
  var toArray = function(args) {
    return [].slice.call(args);
  };

  var clone = function(obj) {
    return JSON.parse(JSON.stringify(obj));
  };

  (function performSetup(){

    if (typeof footprints.options == 'undefined'){
      throw LIB_NAME.toUpperCase() + ": your snippet must set " +
        LIB_NAME + ".options to the options object";
    }

    // validate options
    (function(opts){
      if(typeof opts.endpointUrl == 'undefined'){
        throw LIB_NAME.toUpperCase() + ": you must pass the option endpointUrl";
      }

      // set default values for optional arguments
      opts.intervalWait = opts.intervalWait || DEFAULT_INTERVAL_WAIT;
      opts.debug = opts.debug || false;
      opts.pageTime = (opts.pageTime || new Date()).toISOString();
      opts.successCallback = opts.successCallback || footprints.noop;
      opts.errorCallback = opts.errorCallback || footprints.noop;
      opts.uniqueIdFunc = opts.uniqueIdFunc || ulid;
      opts.pageId = opts.pageId || opts.uniqueIdFunc();
    })(footprints.options);

    footprints.state.basePayload.pageTime = footprints.options.pageTime;
    footprints.state.basePayload.pageId = footprints.options.pageId;

    var safeProcessQueues = function(){
      if(typeof footprints.processQueues === 'function'){
        footprints.processQueues();
      }
    }

    // replace the push method from the snippet with one
    // that calls processQueue so we don't have to wait for the timer
    footprints.push = function(){
      footprints.state.inputQueue.push(toArray(arguments));
      safeProcessQueues();
    };

    // set a timer to process retries periodicaly
    window.setInterval(function(){
      safeProcessQueues();
    }, footprints.options.intervalWait);
  })();

  (function run(
    inputQueue,
    outputQueue,
    basePayload,
    debug,
    endpointUrl,
    successCallback,
    errorCallback,
    uniqueIdFunc
  ) {

    var processQueues = footprints.processQueues = function(){
      processInputQueue();
      processOutputQueue();
    }

    var processInputQueue = function() {
      trace("processing input queue");
      var cmd;
      var actionName;
      while (cmd = inputQueue.shift()) {
        actionName = cmd.shift();
        processAction(actionName, cmd);
      }
    };

    var processAction = function(actionName, args) {
      trace('processing action ', actionName, args);
      var f = actions[actionName];
      if (typeof f === "function") {
        f.apply(null, args);
      } else {
        error("Unknown function", actionName);
      }
    };

    var fire = function(eventName, properties ) {
      var payload = clone(properties);
      payload['eventTime'] = new Date().toISOString();
      payload['eventId'] = uniqueIdFunc();
      payload['eventName'] = eventName;
      enqueueOutput(payload);
    };

    var enqueueOutput = function(payload) {
      outputQueue.push(payload);
    }

    var processOutputQueue = function() {
      trace("processing output queue");
      var payload;
      while (payload = outputQueue.shift()) {
        send(payload);
      }
    };

    var send = function(payload) {
      trace("sending event", payload)
      fetch(endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }).then(function(response){
        if (response.status >= 200 && response.status < 300) {
          return response
        } else {
          var error = new Error(response.statusText)
          error.response = response
          throw error
        }
      }).then(sendComplete.bind(null, payload))
        .catch(function(e){
          sendError(payload, e)
        });
    };

    var sendComplete = function(payload, response) {
      successCallback(response);
      trace('Event Sent', payload);
    };

    var sendError = function(payload, e) {
      enqueueOutput(payload);
      errorCallback(e)
      error('Event Failed', e, payload);
    };

    var actions = {
      pageView: function(name, properties) {
        var props = Object.assign(basePayload, properties, pageProps());
        if(name){
          props['name'] = name;
        }
        fire('pageView', props);
      },
      context: function(context) {
        footprints.state.basePayload =
          basePayload =
          Object.assign(basePayload, context);
      },
      track: function(key, properties){
        var props = Object.assign(basePayload, properties);
        if(key){
          props['key'] = key;
        }
        fire('track', props);
      },
      user: function(idOrProperties, properties){
        var props = Object.assign({}, properties);
        if(typeof idOrProperties === 'object'){
          props = Object.assign(props, idOrProperties);
        } else if(idOrProperties){
          props['userId'] = idOrProperties;
        }
        actions.context(props);
      }
    };

    var pageProps = function(){
      var pageProps = {};
      try {
        pageProps.url = window.location.href;
        pageProps.path = window.location.path;
        pageProps.referer = document.referer;
        pageProps.title = document.title;
      } catch(e){
        console.error('could not get page props', e);
      }
      return pageProps;
    }

    var trace = function() {
      if (debug) {
        var args = toArray(arguments);
        args.unshift(LIB_NAME + ':');
        console.log.apply(this, args);
      }
    };

    var error = function() {
      if (debug) {
        var args = toArray(arguments);
        args.unshift(LIB_NAME + ':');
        console.error.apply(this, args);
      }
    };

    //add all actions to Footprints as methods in case the snippet did not
    (function(){
      for (var action in actions) {
        if (actions.hasOwnProperty(action)) {
          footprints[action] = function(){
            var args = toArray(arguments);
            args.unshift(action);
            enqueueInput(args);
            processQueues();
          }
        }
      }
    })();

  })(footprints.state.inputQueue,
    footprints.state.outputQueue,
    footprints.state.basePayload,
    footprints.options.debug,
    footprints.options.endpointUrl,
    footprints.options.successCallback,
    footprints.options.errorCallback,
    footprints.options.uniqueIdFunc
  );
}

if(window[LIB_NAME]){
  init(window[LIB_NAME]);
}
