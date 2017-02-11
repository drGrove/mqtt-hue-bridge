# Getting Started

### Clone the repo
```bash
$ git clone https://github.com/drGrove/mqtt-hue-bridge
```

### Update Your Config
```bash
$ cp config/default.json5 config/local.json5
$ vim config/local.json5
```

Update the following fields:

- Hue Username
- Hue IP
- MQTT Host
- MQTT Username (Optional)
- MQTT Password (Optional)

### Start the Service
```bash
$ npm start
```

### Running in Docker
```bash
$ docker build -t mqtt-hue-bridge .
$ docker run -v $PWD/config:/usr/src/app/config -d mqtt-hue-bridge
```
