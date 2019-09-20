load('api_config.js');
load('api_gpio.js');
load('api_mqtt.js');
load('api_sys.js');
load('api_timer.js');
load('api_bme280.js');
load('api_rpc.js');
load('api_arduino_onewire.js');
load('ds18b20.js');

let relay = Cfg.get('therm.relaypin');
GPIO.set_mode(relay, GPIO.MODE_OUTPUT);
let targetNet = "" + Cfg.get('wifi.sta.ssid');
let slaveMode = false;
if (targetNet.indexOf("Mongoose") === 0) {
  print("Slave mode on, hub ssid: ", targetNet);
  slaveMode = true;
}
let state = {};
let ttl = {};

let thermostat = {
  mode: Cfg.get('therm.mode'),
  t: Cfg.get('therm.t'),
  relay: 0
};
GPIO.set_pull(relay, GPIO.PULL_DOWN);
GPIO.setup_output(relay, 1)

function regulate() {
  if (thermostat.mode === "on") {
    thermostat.relay = 1;
  }
  if (thermostat.mode === "off") {
    thermostat.relay = 0;
  }
  if (thermostat.mode === "auto") {
    let t = null;
    for (let id in state) {
      if (state[id] && (t === null || state[id].t < t)) {
        t = state[id].t;
      }
    }
    if (t < thermostat.t) {
      thermostat.relay = 1;
    } else {
      thermostat.relay = 0;
    }
  }
  GPIO.write(relay, !thermostat.relay)

}

// Reading temperature from bs18b20
let ow = OneWire.create(Cfg.get('therm.bs18b20pin'));
let addr = "        ";
let dsPresent = ow.search(addr, 0);

function readTempDS() {
  let data = { id: Cfg.get('device.id') };
  let t = getTemp(ow, addr);
  if (isNaN(t)) {
    print('No device found');
  } else {
    data.t = t;
  }
  return data;
}

// Reading temperature from BME280
let bmeData = BME280Data.create();
let bme = BME280.createI2C(0x76);

function readTempBME() {
  let data = { id: Cfg.get('device.id') };
  print("BME280 read")
  if (bme.readAll(bmeData) === 0) {
    data.t = bmeData.temp();
    data.p = bmeData.press();
    data.h = bmeData.humid();
  }
  return data;
}

// if present ds18b20 is used for temperature, otherwise BME280  
let readTemp = readTempBME;

if (dsPresent) {
  readTemp = readTempDS;
}

// Remove state from sensors with expired TTL
Timer.set(10000 /* milliseconds */, Timer.REPEAT, function () {
  let uptime = Sys.uptime();
  print("Uptime ", uptime);
  for (let id in state) {
    if (uptime > ttl[id]) {
      state[id] = undefined;
    } else {
      state[id].ttl = ttl[id] - uptime;
    }
  }
  print("State:", JSON.stringify(state));
  print("Thermostat:", JSON.stringify(thermostat));
  regulate();
}, null);


function stateHandler(args) {
  if (args && args.id) {
    state[args.id] = args;
    state[args.id].ttl = 60.0;
    ttl[args.id] = Sys.uptime() + 60.0;
  }
  return state;
}

RPC.addHandler('State', stateHandler);

RPC.addHandler('Thermostat', function (args) {
  if (args && args.mode) {
    thermostat.mode = args.mode;
    if (args.t) {
      thermostat.t = args.t;
    }
  }
  regulate();
  return thermostat;
});

let configTopic = '/devices/' + Cfg.get('device.id') + '/config';

if (Cfg.get('gcp.enable') === true) {
  print("GCP configured");

  MQTT.sub(configTopic, function (conn, topic, msg) {
    print('Topic:', configTopic, 'message:', msg);
    let obj = JSON.parse(msg);
    RPC.call(RPC.LOCAL, "Thermostat", obj, function () { }, null);
  }, null);
}


let topic = '/devices/' + Cfg.get('device.id') + '/state';


function sendTemp(data) {
}

// Read temperature, update state and send state to hub node or to GCP
Timer.set(15000, Timer.REPEAT, function () {
  let data = readTemp();
  data.relay = thermostat.relay;
  let result = RPC.call(RPC.LOCAL, "State", data, function () { }, null);
  print("Local state update:", JSON.stringify(data));
  if (Cfg.get('gcp.enable')) { // publish state to GCP IoT
    print("mqtt published: ", MQTT.pub(topic, JSON.stringify(state), 1));
  }
  if (slaveMode) { // update state in hub node
    print("Remote result:", RPC.call("ws://192.168.4.1/rpc", "State", data, function () { }, null));
  }
}, null);

