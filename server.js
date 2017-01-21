'use strict';
const mqtt = require('mqtt');
const Config = require('config');
const fs = require('fs');
const HueApi = require('node-hue-api').HueApi;
const deepEqual = require('deep-equal');
const localConfig = './config/local.json';
const mqttConf = Config.get('mqtt');
const hueConf = Config.get('hue');
const hueDeviceName = 'hue-mqtt-bridge';

let hueClient = null;
let hueLights = [];
let hueGroups = [];
let hueTimer = null

let mqttOptions = {
  will: {
    topic: `${mqttConf.topic}/connected`,
    message: 0,
    qos: 0
  }
};

if (mqttConf.username && mqttConf.password) {
  mqttOptions.username = mqttConf.username;
  mqttOptions.password = mqttConf.password;
}

const mqttClient = mqtt.connect(`mqtt://${mqttConf.host}`, mqttOptions);

mqttClient.on('connect', () => {
  console.log(`Connected to MQTT: ${mqttConf.host}`);
  publishConnStatus();
  mqttClient.subscribe(`${mqttConf.topic}/set/light/+`);
  mqttClient.subscribe(`${mqttConf.topic}/set/group/+`);
  mqttClient.subscribe(`${mqttConf.topic}/lights/off`); // All off
  mqttClient.subscribe(`${mqttConf.topic}/lights/on`); // All on
});

mqttClient.on('message', (topic, message) => {
  if (!hueClient) {
    return;
  }

  console.log(topic)
  if(topic.startsWith(`${mqttConf.topic}/set/light/`)) {
    let lightName = topic.substr(topic.lastIndexOf('/') + 1);
    if (hueLights[lightName]) {
      let lightOptions = {
        lightNumber: hueLights[lightName].id
      };
      if (IsNumeric(message)) {
        let value = parseInt(message);
        if (value === 0) {
          lightOptions.on = false;
        } else if (value > 0 && value <= 255) {
          lightOptions.on = true;
          lightOptions.bri = value;
        } else {
          console.warn(`${value} is not a valid brightness for : ${lightName}`);
          return;
        }
      } else {
        try {
          let payload = JSON.parse(message);
          lightOptions.on = payload.on;
          lightOptions.bri = payload.bri;
          lightOptions.alert = payload.alert;
          lightOptions.effect = payload.effect;
          lightOptions.transitiontime = payload.transitiontime;
        } catch (e) {
          console.error(e);
          return;
        }
      }

      console.log(`Settling light ${lightName} with ${JSON.stringify(lightOptions)}`);
      clearTimeout(hueTimer);
      hueClient.setLightState(lightOptions.lightNumber, lightOptions, function(err, result) {
        if (err) {
          console.error(error);
          return;
        }

        publishHueStatus()
      })
    } else {
      console.warn(`Light ${lightName} does not exist.`);
    }
  } else if (topic.startsWith(`${mqttConf.topic}/set/group/`)) {
    let groupName = topic.substr(topic.lastIndexOf('/') + 1);
    if (hueGroups[groupName]) {

    } else {
      console.warn(`Group ${groupName} does not exist.`);
    }
  } else if (topic === `${mqttConf.topic}/lightsout`) {
    console.log('Executing lights out');
    clearTimeout(hueTimer);
    hueClient.setGroupLightState(0, {
      on: false
    }, function(err, resp) {
      if (err) {
        console.error(err);
        return;
      }
      publishHueStatus();
    })
  } else if (topic === `${mqttConf.topic}/lightson`) {
    console.log('Executing lights out');
    clearTimeout(hueTimer);
    hueClient.setGroupLightState(0, {
      on: true
    }, function(err, resp) {
      if (err) {
        console.error(err);
        return;
      }
      publishHueStatus();
    })
  }
});

function publishConnStatus () {
  var status = '1';
  if (hueClient && hueConf.username) {
    status = '2';
  }

  mqttClient.publish(`${mqttConf.topic}/connected`, status, {
    qos: 0,
    retain: true
  });
}

let currentConfig;
try {
  currentConfig = JSON.parse(fs.readFileSync(localConfig));
} catch (e) {
  currentConfig = {
    hue: {}
  };
}
hueClient = new HueApi(hueConf.ip, hueConf.username);

if (!hueConf.ip) {
  hueClient.nupnpSearch(function(err, result) {
    if (err) {
      console.error(err);
      process.exit(10);
    }

    if (!currentConfig.hue) {
      currentConfig.hue = {};
    }

    currentConfig.hue.ip = result[0].ipaddress;
    fs.writeFileSync(localConfig, JSON.stringify(currentConfig, null, '   '));

    // Create User
    hueClient.createUser(currentConfig.hue.ip, hueDeviceName, function(err, user) {
      if (err) {
        console.error(err);
        process.exit(11);
      }

      currentConfig.hue.username = user;
      fs.writeFileSync(localConfig, JSON.stringify(currentConfig, null, '   '));

      publishHueStatus();
    });
  });
} else if (!hueConf.username) {
  hueClient.createUser(hueConf.ip, hueDeviceName, function(err, user) {
    if (err) {
      console.error(err);
      process.exit(11);
    }

    currentConfig.hue.username = user;
    fs.writeFileSync(localConfig, JSON.stringify(currentConfig, null, '   '));

    publishHueStatus();
  });
} else {
  publishHueStatus();
}

function publishHueLightStatus() {
  console.log('Start publish hue light status');
  if (!hueClient) {
    return;
  }

  hueClient.lights(function(err, lights) {
    if (err) {
      console.error(err);
      return;
    }

    lights.lights.forEach(function(light) {
      let name = light.name.toLowerCase().replace(/ /g, '_');
      let message = {};

      if (hueLights[name] == null || !deepEqual(hueLights[name].state, light.state)) {
        message = {
          val: 0,
          hue_state: light.state,
          ts: Date.now()
        };
      }

      if (light.state.on && light.state.reachable) {
        message.val = light.state.bri;
      }

      mqttClient
        .publish
          ( `${mqttConf.topic}/status/light/${name}`
          , JSON.stringify(message)
          , { qos: 0
            , retain: true
            }
          )

      hueLights[name] = light;
    });

    hueTimer = setTimeout(publishHueStatus, hueConf.refreshInterval * 1000);
  });
}

function publishHueStatus() {
  publishHueLightStatus();
  publishHueGroupStatus()
}

function publishHueGroupStatus() {
  console.log('Start publish hue group status');
  if (!hueClient) {
    return;
  }

  hueClient.groups(function(err, groups) {
    if (err) {
      console.error(err);
      return;
    }

    groups.forEach(function(group) {
      let name = group.name.toLowerCase().replace(/ /g, '_');
      let message = {};

      message = {
        action: group.action,
        state: group.state,
        lights: group.lights,
        ts: Date.now()
      };

      mqttClient
        .publish
          ( `${mqttConf.topic}/status/group/${name}`
          , JSON.stringify(message)
          , { qos: 0
            , retain: true
            }
          )
    })
  });
};

function IsNumeric(val) {
  return Number(parseFloat(val)) == val;
}
