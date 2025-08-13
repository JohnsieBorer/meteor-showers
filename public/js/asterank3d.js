;function Asterank3D(opts) {
  'use strict';

  var me = this;

  /** Options and defaults **/
  opts.static_prefix = typeof opts.static_prefix === 'undefined' ?
    '/static' : opts.static_prefix;
  opts.default_camera_position = opts.camera_position || [0, -136, 113];
  opts.camera_fly_around = typeof opts.camera_fly_around === 'undefined' ?
    true : opts.camera_fly_around;
  opts.jed_delta = opts.jed_delta || 0;
  opts.custom_object_fn = opts.custom_object_fn || null;
  opts.object_texture_path = opts.object_texture_path ||
    opts.static_prefix + 'img/cloud4.png';
  opts.not_supported_callback = opts.not_supported_callback || function() {};
  opts.sun_scale = opts.sun_scale || 50;
  opts.show_dat_gui = opts.show_dat_gui || false;
  opts.top_object_color = opts.top_object_color ?
      new THREE.Color(opts.top_object_color) : new THREE.Color(0xDBDB70);
  opts.milky_way_visible = opts.milky_way_visible || true;

  // requestAnimFrame polyfill
  window.requestAnimFrame = (function(){
    return  window.requestAnimationFrame       ||
            window.webkitRequestAnimationFrame ||
            window.mozRequestAnimationFrame    ||
            window.oRequestAnimationFrame      ||
            window.msRequestAnimationFrame     ||
            function( callback ){
              window.setTimeout(callback, 1000 / 60);
            };
  })();

  /** Constants **/
  var WEB_GL_ENABLED = true
    , MAX_NUM_ORBITS = 4000

  /** Other variables **/
  var stats, scene, renderer, composer
    , camera, cameraControls
    , pi = Math.PI
    , using_webgl = false
    , object_movement_on = true
    , last_hovered
    , added_objects = []
    , added_particle_orbits = []
    , planets = []
    , planet_orbits_visible = true
    , source_orbit = null
    , jed = toJED(new Date(2025,7,13))
    , particle_system_geometry = null
    , particles_loaded = false
    , display_date_last_updated = 0
    , first_loaded = false
    , skyBox = null

  // Meteor cloud stuff
  var current_cloud_obj = null;
  var showing_cloud_obj = false;

  // Lock/feature stuff
  var feature_map = {}       // map from object full name to Orbit3D instance
    , locked_object = null
    , locked_object_ellipse = null
    , locked_object_idx = -1
    , locked_object_size = -1
    , locked_object_color = -1
    // TODO make this an enum
    , locked_mode = 'FOLLOW'

  // Comet stuff
  var cometOrbitDisplayed = null
    , cometDisplayed = null

  // glsl and webgl stuff
  var attributes
    , uniforms
    , particleSystem
    , num_particles_per_shower = 500

  // DOM related.
  var $select = $('#shower-select')
    , domEvents

  /** Public functions **/

  me.init = function() {
    if (opts.show_dat_gui) {
      initGUI();
    }

    // Sets up the scene
    $('#loading-text').html('renderer');
    if (isWebGLSupported()){
      renderer = new THREE.WebGLRenderer({
        antialias		: true	// to get smoother output
        //preserveDrawingBuffer	: true	// to allow screenshot
      });
      renderer.setClearColor(0x000000, 1);
      using_webgl = true;
      window.gl = renderer.getContext();
    }
    else {
      opts.not_supported_callback();
      return;
    }
    var $container = $(opts.container);
    var containerHeight = $container.height();
    var containerWidth = $container.width();
    renderer.setSize(containerWidth, containerHeight);
    opts.container.appendChild(renderer.domElement);

    // create a scene
    scene = new THREE.Scene();

    // put a camera in the scene
    var cameraH	= 3;
    var cameraW	= cameraH / containerHeight * containerWidth;
    window.cam = camera = new THREE.PerspectiveCamera(75, containerWidth / containerHeight, 1, 5000);

    THREEx.WindowResize(renderer, camera, opts.container);
    if (THREEx.FullScreen && THREEx.FullScreen.available()) {
      THREEx.FullScreen.bindKey();
    }
    domEvents = new THREEx.DomEvents(camera, renderer.domElement);

    me.setDefaultCameraPosition();
    camera.lookAt(new THREE.Vector3(0,0,0));
    camera.up.set(0, 0, 1);
    scene.add(camera);

    cameraControls = new THREE.TrackballControls(camera, opts.container);
    cameraControls.maxDistance = 2200;
    if (window.isMobile) {
      cameraControls.rotateSpeed = 3;
      cameraControls.zoomSpeed = 0.8;
      cameraControls.panSpeed = 0.6;
      cameraControls.noPan = true;
    } else {
      cameraControls.rotateSpeed = 5;
      cameraControls.zoomSpeed = 0.8;
      cameraControls.panSpeed = 0.6;
    }
    //cameraControls.dynamicDampingFactor = 0.5;
    //cameraControls.staticMoving = true;
    window.cc = cameraControls;

    // Rendering solar system
    setupSun();
    setupPlanets();
    setupSkybox();

    setupCloudSelectionHandler();
    setupIAUInputHandler();
    if (!setupSelectionFromUrl()) {
      onVisualsReady(loadNewViewSelection);
    }
    // TODO: this is pretty bad.
    onVisualsReady(setupPlanetsOrbitTooltips);

    $(opts.container).on('mousedown touchstart', function() {
      opts.camera_fly_around = false;
    });

    window.renderer = renderer;
  };  // end init

  me.clearRankings = function() {
    // Remove any old setup
    me.clearLock(true);
    if (particleSystem) {
      scene.remove(particleSystem);
      particleSystem = null;
    }

    if (last_hovered) {
      scene.remove(last_hovered);
    }
  };

  // Camera locking fns
  me.setLockMode = function(mode) {
    locked_mode = mode;
  };

  me.clearLock = function(set_default_camera) {
    if (!locked_object) return;

    if (set_default_camera) {
      me.setDefaultCameraPosition();
    }

    cameraControls.target = new THREE.Vector3(0, 0, 0);

    // restore color and size
    attributes.value_color.value[locked_object_idx] = locked_object_color;
    attributes.size.value[locked_object_idx] = locked_object_size;
    attributes.locked.value[locked_object_idx] = 0.0;
    setAttributeNeedsUpdateFlags();
    if (locked_object_idx >= planets.length) {
      // not a planet
      scene.remove(locked_object_ellipse);
    }

    locked_object = null;
    locked_object_ellipse = null;
    locked_object_idx = -1;
    locked_object_size = -1;
    locked_object_color = null;

    // reset camera pos so subsequent locks don't get into crazy positions
    me.setNeutralCameraPosition();
  };   // end clearLock

  me.setLock = function(full_name) {
    if (locked_object) {
      me.clearLock();
    }

    var mapped_obj = feature_map[full_name];
    if (!mapped_obj) {
      alert("Sorry, something went wrong and I can't lock on this object.");
      return;
    }
    var orbit_obj = mapped_obj['orbit'];
    if (!orbit_obj) {
      alert("Sorry, something went wrong and I can't lock on this object.");
      return;
    }
    locked_object = orbit_obj;
    locked_object_idx = mapped_obj['idx']; // this is the object's position in the added_objects array
    locked_object_color = attributes.value_color.value[locked_object_idx];
    attributes.value_color.value[locked_object_idx] = full_name === 'earth' ?
      new THREE.Color(0x00ff00) : new THREE.Color(0xff0000);
    locked_object_size = attributes.size.value[locked_object_idx];
    attributes.size.value[locked_object_idx] = 30.0;
    attributes.locked.value[locked_object_idx] = 1.0;
    setAttributeNeedsUpdateFlags();

    locked_object_ellipse = locked_object.getEllipse();
    scene.add(locked_object_ellipse);
    opts.camera_fly_around = true;
  }; // end setLock

  me.isWebGLSupported = function() {
    return isWebGLSupported();
  };

  me.setNeutralCameraPosition = function() {
    // Follow floating path around
    var timer = 0.0001 * Date.now();
    cam.position.x = opts.default_camera_position[0] + Math.sin(timer) * 60;
    //cam.position.y = Math.sin( timer ) * 100;
    cam.position.z = opts.default_camera_position[2] + Math.cos(timer) * 50;
  }

  me.setDefaultCameraPosition = function() {
    cam.position.set(opts.default_camera_position[0], opts.default_camera_position[1],
        opts.default_camera_position[2]);
  }

  me.setupParticlesFromData = function(data) {
    if (!data) {
      alert('Sorry, something went wrong and the server failed to return data.');
      return;
    }
    // add planets
    added_objects.push.apply(added_objects, planets);

    for (var i=0; i < planets.length; i++) {
      // FIXME this is a workaround for the poor handling of PSG vertices in ellipse.js
      // needs to be cleaned up
      particle_system_geometry.vertices.push(new THREE.Vector3(0,0,0));
    }

    console.log('Creating', data.length, 'particles from data...');
    for (var i=0; i < data.length; i++) {
      var roid = data[i];
      var locked = false;
      var orbit;
      if (opts.custom_object_fn) {
        var orbit_params = opts.custom_object_fn(roid);
        orbit_params.particle_geometry = particle_system_geometry; // will add itself to this geometry
        orbit_params.jed = jed;
        orbit = new Orbit3D(roid, orbit_params);
      } else {
        var display_color = displayColorForObject(roid);

        orbit = new Orbit3D(roid, {
          color: 0xaaaaaa,
          display_color: display_color,
          width: 2,
          object_size: 20,
          jed: jed,
          particle_geometry: particle_system_geometry // will add itself to this geometry
        });
      }

      // Add it to featured list
      feature_map[roid.full_name] = {
        'orbit': orbit,
        'idx': added_objects.length
      };

      // Add to list of objects in scene
      added_objects.push(orbit);
    } // end particle results for loop

    // jed = toJED(new Date());  // reset date
    if (!particles_loaded) {
      particles_loaded = true;
    }
    createParticleSystem();   // initialize and start the simulation

    if (!first_loaded) {
      animate();
      first_loaded = true;
    }

    $('#loading').hide();

    if (typeof ga !== 'undefined') {
      ga('send', 'event', 'visualization', 'simulation started', undefined, {
        nonInteraction: true
      });
    }
  };    // end setupParticlesFromData

  /** Core private functions **/

  function initGUI() {
    var ViewUI = function() {
      this['Date'] = '8/13/2025';
      this['飞行速度'] = opts.jed_delta;
      this['显示星轨'] = planet_orbits_visible;
      this['显示银河'] = opts.milky_way_visible;
    };

    window.onload = function() {
      var text = new ViewUI();
      var gui = new dat.GUI({width: 300});
      gui.add(text, 'Date').onChange(function(val) {
        var newdate = new Date(Date.parse(val));
        if (newdate) {
          var newjed = toJED(newdate);
          changeJED(newjed);
          if (!object_movement_on) {
            render(true); // force rerender even if simulation isn't running
          }
        }
      }).listen();
      gui.add(text, '飞行速度', 0, 15).onChange(function(val) {
        opts.jed_delta = val;
        var was_moving = object_movement_on;
        object_movement_on = opts.jed_delta > 0;
      });
      gui.add(text, '显示星轨').onChange(function() {
        togglePlanetOrbits();
      });
      gui.add(text, '显示银河').onChange(function() {
        toggleMilkyWay();
      });
      window.datgui = text;
    }; // end window onload
  } // end initGUI

  function togglePlanetOrbits() {
    if (planet_orbits_visible) {
      for (var i=0; i < planets.length; i++) {
        scene.remove(planets[i].getEllipse());
      }
      scene.remove(cometOrbitDisplayed);
    } else {
      for (var i=0; i < planets.length; i++) {
        scene.add(planets[i].getEllipse());
      }
      scene.add(cometOrbitDisplayed);
    }
    planet_orbits_visible = !planet_orbits_visible;
  }

  function toggleMilkyWay() {
    skyBox.visible = opts.milky_way_visible = !opts.milky_way_visible;
  }

  function changeJED(new_jed) {
    jed = new_jed;
  }

  function setHighlight(full_name) {
    // Colors the object differently, but doesn't follow it.
    var mapped_obj = feature_map[full_name];
    var orbit_obj = mapped_obj.orbit;
    if (!mapped_obj || !orbit_obj) {
      alert("Sorry, something went wrong and I can't highlight this object.");
      return;
    }
    var idx = mapped_obj.idx; // this is the object's position in the added_objects array
    attributes.value_color.value[idx] = new THREE.Color(0x0000ff);
    attributes.size.value[idx] = 30.0;
    attributes.locked.value[idx] = 1.0;
    setAttributeNeedsUpdateFlags();
  }

  // Returns true if this function will handle the initial state, because it
  // found something in the url.
  function setupSelectionFromUrl() {
    var param;
    if (window.shower_selection) {
      param = window.shower_selection;
    } else if (window.location.pathname.indexOf('/view/') === 0) {
      // Check for pushstate first.
      param = window.location.pathname.slice(6);
    } else {
      // Or maybe it's set from hash.
      param = window.location.hash.slice(1);
    }
    if (!param) {
      return false;
    }
    param = param.replace('-', ' ');

    if (param == 'all') {
      $select.val('View all');
      onVisualsReady(viewAll);
      return true;
    }

    // Maybe one of the featured showers?
    if (param === 'iau 7') {
      param = 'Perseids';
    } else if (param === 'iau 13') {
      param = 'Leonids';
    }
    var selection = window.METEOR_CLOUD_DATA[param];
    if (selection) {
      $select.val(param || selection.name);
      onVisualsReady(loadNewViewSelection);
      return true;
    }

    // Maybe an IAU number?
    if (param.indexOf('iau') === 0) {
      var iau_num = parseInt(param.replace('iau', ''));
      cleanUpPreviousViewSelection();
      setupUiForIAUSelection(iau_num);
      loadNewIAUSelection(iau_num);
      $select.val('none');
      return true;
    }

    return false;
  }

  var last_iau_number = 0;
  function setupIAUInputHandler() {
    // TODO(ian): Move this out to ui.js.
    $('#btn-iau-input').on('click', function() {
      var iau_num = prompt('What IAU meteor shower number would you like to view?', last_iau_number);
      if (!iau_num && iau_num !== '0') {
        return;
      }

      cleanUpPreviousViewSelection();
      setupUiForIAUSelection(iau_num);
      navigateTo('iau-' + iau_num);
      loadNewIAUSelection(iau_num);
    });
  }

  function setupCloudSelectionHandler() {
    var shower_names = [];
    for (var key in window.METEOR_CLOUD_DATA) {
      shower_names.push(key);
    }

    // Show the upcoming meteor shower that's closest to today.
    var now = new Date();
    shower_names.sort(function(a, b) {
      var showerA = window.METEOR_CLOUD_DATA[a];
      var showerB = window.METEOR_CLOUD_DATA[b];
      if (showerA.hideInMenu) {
        return 1;
      } else if (showerB.hideInMenu) {
        return -1;
      }
      var showerAdate = new Date(showerA.date);
      var showerBdate = new Date(showerB.date);
      showerAdate.setDate(showerAdate.getDate() + 3);
      showerBdate.setDate(showerBdate.getDate() + 3);

      showerAdate.setYear(1900 + now.getYear());
      showerBdate.setYear(1900 + now.getYear());

      // If any of these are in the past, the next shower is next year.
      if (showerAdate < now) {
        showerAdate.setYear(1900 + now.getYear() + 1);
      }
      if (showerBdate < now) {
        showerBdate.setYear(1900 + now.getYear() + 1);
      }
      return showerAdate - showerBdate;
    });

    shower_names.forEach(function(key) {
      var shower = window.METEOR_CLOUD_DATA[key];
      var display = key + ' - ' + shower.peak;
      var $opt = $('<option>').html(display).attr('value', key)
      if (shower.hideInMenu) {
        $opt.hide();
      }
      $opt.appendTo($select);
    });
    $select.append('<option value="View all">Everything at once</option>');
    $select.append('<option value="none">Choose a shower...</option>');

    $select.on('change', function() {
      var val = $(this).val();
      if (val === 'none') {
        return;
      } if (val === 'View all') {
        viewAll();
      } else {
        loadNewViewSelection();
        // window.location.hash = $select.val();
        navigateTo($select.val());
      }
    });
  }

  function populatePictures() {
    // TODO this should not go in the main 3D logic.
    var selection = window.METEOR_CLOUD_DATA[$select.val()];
    if (!selection.pictures || selection.pictures.length < 1) {
      return;
    }

    selection.pictures.forEach(function(pic) {
      $div.append('<a target="_blank" href="' + pic.url +
                  '"><img src="//wit.wurfl.io/w_180/' + pic.url + '" title="' +
                  pic.caption + '"></a>');
    });
    $('#left-nav').empty().append($div);
  }

  function populateMinimap() {
    var $skymap = $('#sky-map');
    var selection = window.METEOR_CLOUD_DATA[$select.val()];
    if (!selection || !selection.map) {
      $skymap.hide();
      return;
    }

    var imgpath = '/img/skymaps/' + selection.map;
    $skymap.find('img').attr('src', imgpath);
    $skymap.show();
  }

  function cleanUpPreviousViewSelection() {
    // Reset view
    particle_system_geometry = new THREE.Geometry();
    added_objects = [];

    // Cleanup previous.
    me.clearRankings();
    if (cometOrbitDisplayed) {
      scene.remove(cometOrbitDisplayed);

      // Clean up mouseovers.
      try {
        domEvents.removeEventListener(cometOrbitDisplayed, 'mouseover');
        domEvents.removeEventListener(cometOrbitDisplayed, 'mouseout');
      } catch(e) {}
    }
    for (var i=0; i < added_particle_orbits.length; i++) {
      scene.remove(added_particle_orbits[i]);
    }
  }

  function setupUiForIAUSelection(iau_num) {
    $('#iau-summary').show();
    $('#view-all-summary').hide();
    $('#normal-summary').hide();
    $('#iau-shower-number').html(iau_num);
    $('#iau-shower-suffix').empty();
    var iau_num_int = parseInt(iau_num, 10);
    for (var key in window.METEOR_CLOUD_DATA) {
      if (window.METEOR_CLOUD_DATA.hasOwnProperty(key)) {
        var obj = window.METEOR_CLOUD_DATA[key];
        if (obj.iau_number === iau_num_int) {
          $('#iau-shower-suffix').html(' - ' + obj.name);
          return;
        }
      }
    }
  }

  function getCamsSplitUrlSegment() {
    return 'cams_splits_2016';
  }

  function loadNewIAUSelection(iau_num, cb) {
    last_iau_number = iau_num;
    loadOrbitsData('/js/data/' + getCamsSplitUrlSegment() + '/iau_' + iau_num + '.json', cb);
  }

  function getIAUOrbitsJson(iau_num, cb) {
    $.getJSON('/js/data/' + getCamsSplitUrlSegment() + '/iau_' + iau_num + '.json', cb);
  }

  function loadOrbitsData(url, cb) {
    showLoader();
    $.getJSON(url, function(cloud_obj) {
      current_cloud_obj = cloud_obj;
      loadParticlesFromOrbitData(cloud_obj);
      hideLoader();
      if (cb) cb();
    }).fail(function(err) {
      hideLoader();
      if (typeof mixpanel !== 'undefined') {
        mixpanel.track('ajax load failed', {
          url: url,
          error: err
        });
      }
      if (cb) cb();
      alert('Sorry, your request for meteor shower data has failed: not an established shower or no data, please try again.');
    });
  }

  function loadNewViewSelection() {
    cleanUpPreviousViewSelection();
    num_particles_per_shower = 1500;

    $('#iau-summary').hide();
    $('#view-all-summary').hide();
    $('#normal-summary').show();

    var key = $select.val();
    var cloud_obj = window.METEOR_CLOUD_DATA[key];
    if (!cloud_obj) {
      console.error('Tried to load key', key);
      alert("Something went wrong - couldn't load data for this meteor shower!");
      return;
    }

    // Update caption
    $('#meteor-shower-name').html(cloud_obj.name);
    $('#meteor-shower-peak').html(cloud_obj.peak);

    if (cloud_obj.source_type && cloud_obj.source_name) {
      console.log(cloud_obj)
      $('#meteor-shower-source-type').html(cloud_obj.source_type || 'comet');
      $('#meteor-shower-object-name').html(cloud_obj.source_name);
      $('#meteor-shower-object-name').attr('href', cloud_obj.spaceref_url);
    } else {
      $('#meteor-shower-source-type').empty();
      $('#meteor-shower-object-name').html('an unknown object');
      $('#meteor-shower-object-name').attr('href', 'https://www.spacereference.org/');
    }

    // Add it to visualization.
    addCloudObj(cloud_obj);

    // Update left bar.
    //populatePictures();
    if (!window.isMobile && !window.isIframe) {
      populateMinimap();
    }
  }

  // Takes a cloud object and creates an orbit from it.  Adds the orbit, its
  // particles, and other annotations to the simulation.
  function addCloudObj(cloud_obj) {
    // Add new comet.
    if (cloud_obj.source_orbit) {
      var comet = new Orbit3D(cloud_obj.source_orbit, {
        color: 0xccffff, width: 1, jed: jed, object_size: 1.7,
        display_color: new THREE.Color(0xff69b4), // hot pink
        particle_geometry: particle_system_geometry,
        name: cloud_obj.source_name,
      });
      cometDisplayed = comet;
      cometOrbitDisplayed = comet.getEllipse();
      if (planet_orbits_visible) {
        scene.add(cometOrbitDisplayed);
      }

      // Add mouseover label.
      annotateOrbit(comet.opts.name, comet.getFatEllipse());
    }

    // Add meteor cloud.
    loadParticles(cloud_obj);
  }

  // Adds particles to the simulation.
  function loadParticles(cloud_obj) {
    // TODO(ian): loader
    //$('#loading').show();
    //$('#loading-text').html('asteroids database');
    if (cloud_obj.source_orbit) {
      console.log('Adding cloud source object...');
      added_objects.push(new Orbit3D(cloud_obj.source_orbit, {
        color: new THREE.Color(0x800080),
        display_color: new THREE.Color(0x800080),
        width: 2,
        object_size: 40,
        jed: jed,
        particle_geometry: particle_system_geometry // will add itself to this geometry
      }));
      showing_cloud_obj = true;
    } else {
      showing_cloud_obj = false;
    }

    if (cloud_obj.full_orbit_data) {
      // We have real data on meteor showers.
      loadParticlesFromOrbitData(cloud_obj.full_orbit_data);
    } else if (cloud_obj.orbit_data_path) {
      loadOrbitsData(cloud_obj.orbit_data_path, function() {
        if (cloud_obj.show_particle_orbits) {
          onVisualsReady(addParticleOrbits);
        }
      });
    } else if (cloud_obj.iau_number) {
      loadNewIAUSelection(cloud_obj.iau_number, function() {
        // No callback.
      });
    } else if (cloud_obj.source_orbit) {
      // We only have the comet's orbit, no meteor-specific data.
      var data = simulateMeteorShowerFromBaseOrbit(cloud_obj.source_orbit);
      onVisualsReady(me.setupParticlesFromData, data);
    }
    current_cloud_obj = cloud_obj;
  }

  function loadParticlesFromOrbitData(orbit_data) {
    onVisualsReady(me.setupParticlesFromData, orbit_data);
  }

  function addParticleOrbits() {
    for (var j=planets.length; j < added_objects.length; j++) {
      var ellipse = added_objects[j].getSkinnyEllipse();
      added_particle_orbits.push(ellipse);
      scene.add(ellipse);
    }
  }

  // Creates a meteor cloud based on the orbit of a comet or asteroid, or any
  // kepler orbit.
  function simulateMeteorShowerFromBaseOrbit(base) {
    var data = [base];
    var between = function(min, max) {
      return Math.random() * (min - max) + max;
    }

    for (var i=0; i < num_particles_per_shower; i++) {
      var variant = $.extend(true, {}, base);
      variant.epoch = Math.random() * variant.epoch;
      if (base.a > 5) {
        // Further out than jupiter, fill in more.
        variant.a = variant.a * between(0.4, 1.2);
      } else {
        // Inside jupiter, there's more of a tail.
        variant.a = variant.a * between(0.8, 1.2);
      }
      variant.e = variant.e * between(0.99, 1.01);
      variant.i = variant.i * between(0.99, 1.01);
      // No set period when semimajor axis, etc. are being changed.
      delete variant.p;
      data.push(variant);
    }
    return data;
  }

  // Loads every meteor shower at once.
  function viewAll() {
    $('#iau-summary').hide();
    $('#view-all-summary').show();
    $('#normal-summary').hide();
    populateMinimap();

    // window.location.hash = '#all';
    navigateTo('all');

    cleanUpPreviousViewSelection();
    num_particles_per_shower = 500;
    var everything = {
      full_orbit_data: [],
    };
    var already_added = {};
    var numReturned = 0;
    var numExpected = 0;
    for (var cloud_obj_key in window.METEOR_CLOUD_DATA) {
      var cloud_obj = window.METEOR_CLOUD_DATA[cloud_obj_key];
      if (cloud_obj.hideInMenu || already_added[cloud_obj.source_orbit.full_name]) {
        continue;
      }

      if (cloud_obj.full_orbit_data) {
        everything.full_orbit_data.push.apply(
          everything.full_orbit_data, cloud_obj.full_orbit_data);
      } else if (cloud_obj.iau_number) {
        getIAUOrbitsJson(cloud_obj.iau_number, function(data) {
          everything.full_orbit_data.push.apply(everything.full_orbit_data, data);
          numReturned++;
        });
        numExpected++;
      }
      /*else {
        everything.full_orbit_data.push.apply(
          everything.full_orbit_data,
          simulateMeteorShowerFromBaseOrbit(cloud_obj.source_orbit));
      }*/
      already_added[cloud_obj.source_orbit.full_name] = true;
    }

    var waitStart = new Date();
    var waitInterval = setInterval(function() {
      // Wait til all the data has been fetched, or 20 seconds have passed.
      if (numExpected === numReturned || new Date() - waitStart > 20000) {
        loadParticles(everything);
        clearInterval(waitInterval);
      }
    }, 100);
  }

  function createParticleSystem() {
    // Attributes
    attributes = {
      a: { type: 'f', value: [] },
      e: { type: 'f', value: [] },
      i: { type: 'f', value: [] },
      o: { type: 'f', value: [] },
      ma: { type: 'f', value: [] },
      n: { type: 'f', value: [] },
      w: { type: 'f', value: [] },
      epoch: { type: 'f', value: [] },
      size: { type: 'f', value: [] },
      value_color : { type: 'c', value: [] },

      // Attributes can't be bool or int in some versions of opengl
      locked: { type: 'f', value: [] },
      is_planet: { type: 'f', value: [] },

      // Highlight attributes
      highlight_above_ecliptic: { type: 'f', value: [] },
      highlight_below_ecliptic: { type: 'f', value: [] },
    };

    uniforms = {
      color: { type: 'c', value: new THREE.Color(0xffffff) },
      jed: { type: 'f', value: jed },
      earth_i: { type: 'f', value: Ephemeris.earth.i },
      earth_om: { type: 'f', value: Ephemeris.earth.om },
      planet_texture: {
        type: 't',
        value: loadTexture(opts.static_prefix + 'img/cloud4.png')
      },
      small_roid_texture:
        { type: 't', value: loadTexture(opts.object_texture_path) },
      small_roid_circled_texture: {
        type: 't',
        value: loadTexture(opts.static_prefix + 'img/cloud4-circled.png')
      },
    };
    var particle_system_shader_material = new THREE.ShaderMaterial( {
      uniforms:       uniforms,
      attributes:     attributes,
      vertexShader:   document.getElementById('orbit-vertex-shader').textContent,
      fragmentShader: document.getElementById('orbit-fragment-shader').textContent
    });
    particle_system_shader_material.depthTest = false;
    particle_system_shader_material.vertexColor = true;
    particle_system_shader_material.transparent = true;

    var num_big_particles = showing_cloud_obj ? planets.length + 1 : planets.length;
    for (var i = 0; i < added_objects.length; i++) {
      var obj = added_objects[i];
      if (i < num_big_particles) {
        attributes.size.value[i] = 100;
        attributes.is_planet.value[i] = 1.0;
        attributes.highlight_above_ecliptic.value[i] = 0.0;
        attributes.highlight_below_ecliptic.value[i] = 0.0;
      } else {
        attributes.size.value[i] = obj.opts.object_size;
        attributes.is_planet.value[i] = 0.0;
        attributes.highlight_above_ecliptic.value[i] =
            current_cloud_obj.highlight_ecliptic ? 1.0 : 0.0;
        attributes.highlight_below_ecliptic.value[i] =
            current_cloud_obj.highlight_ecliptic ? 1.0 : 0.0;
      }

      attributes.a.value[i] = obj.eph.a;
      attributes.e.value[i] = obj.eph.e;
      attributes.i.value[i] = obj.eph.i;
      attributes.o.value[i] = obj.eph.om;
      attributes.ma.value[i] = obj.eph.ma || 0; // TODO
      attributes.n.value[i] = obj.eph.n || -1.0;
      attributes.w.value[i] = obj.eph.w_bar ||
        (obj.eph.w + obj.eph.om);
      attributes.epoch.value[i] = obj.eph.epoch ||
        Math.random() * 2451545.0;
      attributes.value_color.value[i] = obj.opts.display_color ||
        new THREE.Color(0xff00ff);
      attributes.locked.value[i] = 0.0;
      particle_system_geometry.vertices.push(new THREE.Vector3(0, 0, 0));
    }  // end added_objects loop
    setAttributeNeedsUpdateFlags();

    particleSystem = new THREE.ParticleSystem(
      particle_system_geometry,
      particle_system_shader_material
    );
    window.ps = particleSystem;

    scene.add(particleSystem);
  }

  function setAttributeNeedsUpdateFlags() {
    attributes.value_color.needsUpdate = true;
    attributes.locked.needsUpdate = true;
    attributes.size.needsUpdate = true;
  }

  // Main animation loop
  function animate() {
    if (!particles_loaded) {
      render();
      requestAnimFrame(animate);
      return;
    }
    if (opts.camera_fly_around) {
      if (locked_object) {
        // Follow locked object
        var pos = locked_object.getPosAtTime(jed);
        if (locked_mode == 'FOLLOW') {
          cam.position.set(pos[0]+2, pos[1]+2, pos[2]-2);
          //cam.position.set(pos[0], pos[1], pos[2]);
          cameraControls.target = new THREE.Vector3(pos[0], pos[1], pos[2]);
        } else /* mode VIEW_FROM */ {
          cam.position.set(pos[0], pos[1], pos[2]);
          /*
          if (cometDisplayed) {
            // TODO Reset camera target if user clicks off follow.
            var cometPos = cometDisplayed.getPosAtTime(jed);;
            cameraControls.target =
              new THREE.Vector3(cometPos[0], cometPos[1], cometPos[2]);
          }
          */
          cameraControls.target = new THREE.Vector3(-100, 0, 0);
        }
      } else {
        me.setNeutralCameraPosition();
      }
    }
    render();
    requestAnimFrame(animate);
  }

  // Render the scene at this timeframe.
  function render(force) {
    // Update camera controls.
    cameraControls.update();

    // Update display date.
    var now = new Date().getTime();
    if (now - display_date_last_updated > 500 &&
        typeof datgui !== 'undefined') {
      var georgian_date = fromJED(jed);
      var datestr = georgian_date.getMonth()+1 + "/"
        + georgian_date.getDate() + "/" + georgian_date.getFullYear();
      datgui['Date'] = datestr;
      $('#current-date').html(datestr);
      display_date_last_updated = now;
    }

    if (object_movement_on || force) {
      // Update shader vals for asteroid cloud.
      uniforms.jed.value = jed;
      jed += opts.jed_delta;
    }

    // Actually render the scene.
    renderer.render(scene, camera);
  }

  function setupSun() {
    // Sun is at 0,0
    $('#loading-text').html('sun');
    var texture = loadTexture(opts.static_prefix + 'img/sunsprite.png');
    var sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture,
      blending: THREE.AdditiveBlending,
      useScreenCoordinates: false,
      color: 0xffffff
    }));
    sprite.scale.x = opts.sun_scale;
    sprite.scale.y = opts.sun_scale;
    sprite.scale.z = 1;
    scene.add(sprite);
  }

  function setupPlanets() {
    $('#loading-text').html('planets');
    var mercury = new Orbit3D(Ephemeris.mercury, {
      color: 0x913CEE, width: 1, jed: jed, object_size: 1.7,
      texture_path: opts.static_prefix + 'img/texture-mercury.jpg',
      display_color: new THREE.Color(0x913CEE),
      particle_geometry: particle_system_geometry,
      name: 'Mercury'
    });
    var venus = new Orbit3D(Ephemeris.venus, {
      color: 0xFF7733, width: 1, jed: jed, object_size: 1.7,
      texture_path: opts.static_prefix + 'img/texture-venus.jpg',
      display_color: new THREE.Color(0xFF7733),
      particle_geometry: particle_system_geometry,
      name: 'Venus'
    });
    var earth = new Orbit3D(Ephemeris.earth, {
      color: 0x009ACD, width: 1, jed: jed, object_size: 1.7,
      texture_path: opts.static_prefix + 'img/texture-earth.jpg',
      display_color: new THREE.Color(0x009ACD),
      particle_geometry: particle_system_geometry,
      name: 'Earth'
    });
    feature_map['earth'] = {
      orbit: earth,
      idx: 2
    };
    var mars = new Orbit3D(Ephemeris.mars, {
      color: 0xA63A3A, width: 1, jed: jed, object_size: 1.7,
      texture_path: opts.static_prefix + 'img/texture-mars.jpg',
      display_color: new THREE.Color(0xA63A3A),
      particle_geometry: particle_system_geometry,
      name: 'Mars'
    });
    var jupiter = new Orbit3D(Ephemeris.jupiter, {
      color: 0xFFB90F, width: 1, jed: jed, object_size: 1.7,
      texture_path: opts.static_prefix + 'img/texture-jupiter.jpg',
      display_color: new THREE.Color(0xFFB90F),
      particle_geometry: particle_system_geometry,
      name: 'Jupiter'
    });
    var saturn = new Orbit3D(Ephemeris.saturn, {
      color: 0x336633, width: 1, jed: jed, object_size: 1.7,
      texture_path: opts.static_prefix + 'img/texture-saturn.jpg',
      display_color: new THREE.Color(0x336633),
      particle_geometry: particle_system_geometry,
      name: 'Saturn'
    });
    var uranus = new Orbit3D(Ephemeris.uranus, {
      color: 0x0099FF, width: 1, jed: jed, object_size: 1.7,
      texture_path: opts.static_prefix + 'img/texture-uranus.jpg',
      display_color: new THREE.Color(0x0099FF),
      particle_geometry: particle_system_geometry,
      name: 'Uranus'
    });
    var neptune = new Orbit3D(Ephemeris.neptune, {
      color: 0x3333FF, width: 1, jed: jed, object_size: 1.7,
      texture_path: opts.static_prefix + 'img/texture-neptune.jpg',
      display_color: new THREE.Color(0x3333FF),
      particle_geometry: particle_system_geometry,
      name: 'Neptune'
    });

    planets = [mercury, venus, earth, mars, jupiter, saturn, uranus, neptune];
    planets.forEach(function(planet) {
      scene.add(planet.getSolidEllipse());
    });
  }

  function setupPlanetsOrbitTooltips() {
    // TODO probably shouldn't be in main 3d logic.
    planets.forEach(function(planet) {
      annotateOrbit(planet.opts.name, planet.getFatEllipse());
    });
  }

  var hideTimeout, hideTimeoutIsForName;
  var hoverTimeout, hoverTimeoutIsForName;
  function annotateOrbit(name, ellipse) {
    return false;
    var $globalTooltip = $('#global-tooltip');
    domEvents.addEventListener(ellipse, 'mouseover', function(e) {
      // Wait ~100ms for user to remain hovering. This prevents tooltips from
      // appearing when user simply passes mouse over the orbit.
      if (!hoverTimeout) {
        hoverTimeout = setTimeout(function() {
          hoverTimeout = null;
          if (hoverTimeoutIsForName != name) {
            // Hover target changed.
            return;
          }

          // Build tooltip.
          var x = e.origDomEvent.clientX + 10;
          var y = e.origDomEvent.clientY - 5;

          var tip = name;
          /*
          if (point.desc) {
            tip += '<br><span>' + point.desc + '</span>';
          }
          if (point.img) {
            tip += '<img src="' + point.img + '">';
          }
          */
          $globalTooltip.css({
            top: y + 'px',
            left: x + 'px',
          }).html(tip).show();

          if (name != hideTimeoutIsForName) {
            clearTimeout(hideTimeout);
          }
        }, 100);
        hoverTimeoutIsForName = name;
      }
    });

    domEvents.addEventListener(ellipse, 'mouseout', function(e) {
      hideTimeout = setTimeout(function() {
        $globalTooltip.hide();
        hideTimeoutIsForName = null;
      }, 500);
      hideTimeoutIsForName = name;
    }, false);
  }

  function setupSkybox() {
    var geometry = new THREE.SphereGeometry(2800, 60, 40);
    var uniforms = {
      texture: {
        type: 't', value: loadTexture(opts.static_prefix + 'img/eso_dark.jpg')
      }
    };

    var material = new THREE.ShaderMaterial( {
      uniforms:       uniforms,
      vertexShader:   document.getElementById('sky-vertex').textContent,
      fragmentShader: document.getElementById('sky-density').textContent
    });

    skyBox = new THREE.Mesh(geometry, material);
    skyBox.scale.set(-1, 1, 1);
    skyBox.eulerOrder = 'XYZ';
    // Radians to degrees in terms of pi: https://www.quia.com/jg/321176list.html
    skyBox.rotation.x = pi;
    skyBox.rotation.y = pi;
    skyBox.rotation.z = 3/2*pi;
    skyBox.renderDepth = 1000.0;
    scene.add(skyBox);
    window.skyBox = skyBox;
  }

  function onVisualsReady() {
    var args = Array.prototype.slice.call(arguments);
    var fn = args[0];
    args.shift();

    setTimeout(function() {
      fn.apply(me, args);
    }, 0);
  }

  /** Util functions **/

  function loadTexture(path) {
    if (typeof passthrough_vars !== 'undefined' &&
        passthrough_vars.offline_mode) {
      // same origin policy workaround
      var b64_data = $('img[data-src="' + path + '"]').attr('src');

      var new_image = document.createElement( 'img' );
      var texture = new THREE.Texture( new_image );
      new_image.onload = function()  {
        texture.needsUpdate = true;
      };
      new_image.src = b64_data;
      return texture;
    }
    return THREE.ImageUtils.loadTexture(path);
  }

  function isWebGLSupported() {
    return WEB_GL_ENABLED && Detector.webgl;
  }

  function showLoader() {
    $('#loading-container').show();
  }

  function hideLoader() {
    $('#loading-container').hide();
  }
}
