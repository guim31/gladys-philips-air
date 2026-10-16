# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Network**: it talks to the purifiers at the IP addresses entered in the configuration, over UDP port 5683
  (CoAP), on the local network only. It opens no listening port reachable from outside the container and
  calls no cloud service.
- **Encryption**: the protocol of the purifiers encrypts its messages with a key derived from a constant
  shared by every device ("JiangPan"): it hides nothing from someone on the same network. Anyone on the LAN can
  read and drive these purifiers, with or without Gladys; this is a property of the devices.
- **Stored in `/data`** (`philips-air-state.json`): for each purifier, its address, its model, its name in the
  Philips app, the keys its status reports, the maintenance alerts already fired and the running boosts.
  No password, token or session key: there is none to store, and the session counters stay in memory.
- **Logs**: no session key, no decrypted status, no device identifier.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)), the Philips firmware and the
Philips (Versuni) cloud services.
