FROM node:7.5-onbuild
MAINTAINER Danny Grove <danny@drgrovellc.com>

ONBUILD ADD . /usr/src/app
ONBUILD RUN npm install

CMD ["npm", "start"]
