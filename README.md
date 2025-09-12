# ioBroker Script for Buderus Logamatic 4000 Monitoring

This repository contains a JavaScript script for ioBroker that decodes data from a Buderus Logamatic 4000 heating controller received via MQTT and stores them as individual data points in ioBroker. The script is designed for read-only monitoring and is based on reverse-engineering the ECO-CAN bus protocol.

## Description
The script subscribes to an MQTT state in ioBroker that receives raw CAN bus messages from the Logamatic controller. These messages are decoded and transformed into structured data points, such as temperatures, status flags, and operational values for heating circuits, boilers, solar systems, etc. The data is stored under a configurable root path in ioBroker (e.g., as nested objects under `0_userdata.0.Heizung.Buderus`).

The script supports monitors for:
- Heating circuits (e.g., flow/return temperatures, room setpoint temperatures)
- Boiler (floor-standing or wall-mounted)
- Domestic hot water
- Solar system
- Heat quantity
- Configuration (e.g., outdoor temperature, modules in slots)

It is a port of the decoding logic from Python to JavaScript and runs as a script in ioBroker.

## Sources and Dependencies
This script builds on community contributions:
- Protocol decoding is based on [flyingflo's repository](https://github.com/flyingflo/logamatic).
- Additional decoding insights were drawn from Peter Holzleitner's Perl script: [holzleitner.com/el/buderus-monitor](https://holzleitner.com/el/buderus-monitor/index-en.html).


The CAN bus interface on the ESP8266 is based on:
- [flyingflo/heat_can](https://github.com/flyingflo/heat_can): Firmware for the ESP8266 with MCP2515 CAN controller, which sends raw CAN messages over MQTT.

Many thanks to @flyingflo for the reverse-engineering work on the protocol!

## Requirements
- ioBroker with an enabled MQTT adapter (e.g., `mqtt.0`).
- An MQTT broker (e.g., Mosquitto) that receives messages from the ESP8266.
- Hardware: ESP8266 with CAN module (MCP2515), connected to the ECO-CAN bus of the Logamatic 4000.
- The firmware on the ESP8266 must send CAN messages as MQTT payload (format: `rtr;pkidHex;hexbytes...`).

## Installation and Configuration
1. Copy the script (`logamatic4000.js`) to your ioBroker script folder or create it via the ioBroker admin interface.
2. Adjust the following variables in the script to match your environment:
   - `const MQTT_STATE = 'mqtt.0.heizung.burner.can.raw.recv';`  
     Adapt this to the ioBroker state that receives raw MQTT messages from the ESP8266. This is the path where CAN messages arrive as string payloads (e.g., `0;421;88 00 0c 19 05 13 00 00`).
   - `const ROOT = '0_userdata.0.Heizung.Buderus';`  
     This is the root path in ioBroker where decoded data points are created and updated (e.g., `0_userdata.0.Heizung.Buderus.Heizkreis_1.Vorlaufsolltemperatur`).
3. Start the script in ioBroker. It automatically listens for changes in the MQTT state and decodes incoming messages.
4. Ensure the ESP8266 is correctly configured and sends messages to the MQTT broker.

## Functionality
- The script reacts to changes in the MQTT state.
- It parses raw hex bytes from the payload.
- Based on the monitor ID (OID), an appropriate data object is instantiated (e.g., for heating circuits or solar).
- The bytes are decoded into meaningful values (e.g., temperatures, flags) and stored as ioBroker states.
- Logging is done via ioBroker's `log` function (debug level for detailed output).
- Currently read-only: No write operations to the Logamatic (e.g., configuration changes).

## Known Limitations
- Only selected monitors are decoded (based on the Python original).
- No error handling for invalid messages (logged as errors).
- Nested data points use underscores instead of spaces (e.g., `Betriebswerte_1`).

## License
This script is distributed under the MIT License (MIT).

The MIT License (MIT)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Contributions
Pull requests for improvements or extensions are welcome!
