# Front-end image: the official nginx image with the web build (reference-deployment.md, "Public deployment").
# Build from the repository root after `npm run build -w apps/web`:
#   docker build -f deploy/front/Dockerfile -t graftlab-front .
FROM nginx:1.27-alpine
RUN rm -f /etc/nginx/conf.d/default.conf
# The nginx image fills ${...} in /etc/nginx/templates/*.template from the environment at start.
COPY deploy/front/graftlab.conf.template /etc/nginx/templates/graftlab.conf.template
COPY deploy/front/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY apps/web/dist/ /usr/share/nginx/html/
# Published Replays are mounted here (or copied in); the build's own copy is not used.
RUN rm -rf /usr/share/nginx/html/replays && mkdir -p /usr/share/nginx/html/replays
ENV BACKEND_UPSTREAM=host.docker.internal:8080
EXPOSE 8080
