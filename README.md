# invidious-stripped-down

Invidious api just for api dash manifest and `latest_version`.

## Variables

Environment variables are used to configure the application.

| Variable        | Default     | Description                                              |
| --------------- | ----------- | -------------------------------------------------------- |
| `DNS_ORDER`     | `verbatim`  | DNS order for lookups. Other possible value: `ipv4first` |
| `HOST_PROXY`    | `undefined` | Host proxy                                               |
| `KEYV_MAX_SIZE` | `5000`      | Keyv max size                                            |
| `KEYV_ADDRESS`  | `undefined` | Keyv address, In-memory if not defined                   |
| `BIND_PORT`     | `3000`      | Port                                                     |
| `BIND_ADDRESS`  | `0.0.0.0`   | Address                                                  |

## Usage

Set environment variables as needed.

### Docker

```bash
docker run -d \
  -e HOST_PROXY=invidious.io \
  -p 3000:3000 \
  --name invidious-stripped-down \
  quay.io/skyluker4/invidious-stripped-down
```

### Node

```bash
HOST_PROXY=invidious.io node index.js
```

## Setup

### Nginx

Set the following locations to be passed to this application.

- `~* ^/api/manifest/hls_playlist/`
- `~* ^/api/manifest/hls_variant/`
- `~* ^/api/manifest/dash/id/`
- `/latest_version`

#### Example

```nginx
location ~* ^/api/manifest/hls_playlist/ {
  proxy_pass http://invidious-stripped-down:3000;
}

location ~* ^/api/manifest/hls_variant/ {
  proxy_pass http://invidious-stripped-down:3000;
}

location ~* ^/api/manifest/dash/id/ {
  proxy_pass http://invidious-stripped-down:3000;
}

location /latest_version {
  proxy_pass http://invidious-stripped-down:3000;
}
```
