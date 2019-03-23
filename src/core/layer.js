/**
 * @fileOverview Layer基类
 * @author lzx199065@gmail.com
 */
import Base from './base';
import * as THREE from './three';
import ColorUtil from '../attr/color-util';
import Controller from './controller/index';
import source from './source';
import pickingFragmentShader from '../core/engine/picking/picking_frag.glsl';
// import PickingMaterial from '../core/engine/picking/pickingMaterial';
import Attr from '../attr/index';
import Util from '../util';
import Global from '../global';
let id = 1;
function parseFields(field) {
  if (Util.isArray(field)) {
    return field;
  }
  if (Util.isString(field)) {
    return field.split('*');
  }
  return [ field ];
}

export default class Layer extends Base {
  getDefaultCfg() {
    return {
      visible: true,
      zIndex: 0,
      type: '',
      minZoom: 0,
      maxZoom: 22,
      rotation: 0,
      option: {},
      attrOptions: {
      },
      scaleOptions: {},
      scales: {},
      attrs: {},
      // 样式配置项
      styleOptions: {
        stroke: 'none',
        strokeWidth: 1.0,
        opacity: 1.0,
        strokeOpacity: 1.0,
        texture: false
      },
      destroyed: false,
      // 选中时的配置项
      selectedOptions: null,
      // active 时的配置项
      activedOptions: {
        fill: [ 1.0, 0, 0, 1.0 ]
      },
      animateOptions: {
        enable: false
      }
    };
  }
  constructor(scene, cfg) {
    super(cfg);
    this.scene = scene;
    this.map = scene.map;
    this._object3D = new THREE.Object3D();
    this._pickObject3D = new THREE.Object3D();
    this._object3D.visible = this.get('visible');
    this._object3D.renderOrder = this.get('zIndex') || 0;
    const layerId = this._getUniqueId();
    this.layerId = layerId;
    this._activeIds = null;
    const world = scene._engine.world;
    world.add(this._object3D);
    this.layerMesh = null;
    this.layerLineMesh = null;
    this._initEvents();

  }
  /**
   * 将图层添加加到 Object
   * @param {*} object three 物体
    * @param {*} type mesh类型是区别是填充还是边线
   */
  add(object, type = 'fill') {
    type === 'fill' ? this.layerMesh = object : this.layerLineMesh = object;

    this._visibleWithZoom();
    this._zoomchangeHander = this._visibleWithZoom.bind(this);
    this.scene.on('zoomchange', this._zoomchangeHander);

    object.onBeforeRender = () => { // 每次渲染前改变状态
      const zoom = this.scene.getZoom();
      object.material.setUniformsValue('u_time', this.scene._engine.clock.getElapsedTime());
      object.material.setUniformsValue('u_zoom', zoom);
      this.preRender();
    };

    object.onAfterRender = () => { // 每次渲染后改变状态
      this.afterRender();
    };
    // 更新
    if (this._needUpdateFilter) { // 动态更新数据过滤
      this._updateFilter(object);
    }
    this._object3D.add(object);
    if (type === 'fill') {
      this._addPickMesh(object);// 不对边界线进行拾取
    }
  }
  remove(object) {
    this._object3D.remove(object);
  }
  _getUniqueId() {
    return id++;
  }
  _visible(visible) {
    this.set('visible', visible);
    this._object3D.visible = this.get('visible');
  }
  source(data, cfg = {}) {
    cfg.data = data;
    cfg.mapType = this.scene.mapType;
    this.layerSource = new source(cfg);
    // this.scene.workerPool.runTask({
    //   command: 'geojson',
    //   data: cfg
    // }).then(data => {
    //   console.log(data);
    // });
    return this;
  }
  color(field, values) {
    this._needUpdateColor = true;// 标识颜色是否需要更新
    this._createAttrOption('color', field, values, Global.colors);
    return this;
  }
  size(field, values) {
    const fields = parseFields(field);
    if (fields.indexOf('zoom') !== -1) {
      this._zoomScale = true;
    }
    if (Util.isArray(fields) && !values) values = fields;
    this._createAttrOption('size', field, values, Global.size);
    return this;
  }
  scale(field, cfg) {
    const options = this.get('scaleOptions');
    const scaleDefs = options;
    if (Util.isObject(field)) {
      Util.mix(scaleDefs, field);
    } else {
      scaleDefs[field] = cfg;
    }
    return this;
  }
  shape(field, values) {
    if (field.split(':').length === 2) {
      this.shapeType = field.split(':')[0];
      field = field.split(':')[1];
    }
    values === 'text' ? this.shapeType = values : null;

    this._createAttrOption('shape', field, values, Global.shape);
    return this;
  }
  /**
   * 是否允许使用默认的图形激活交互
   * @param  {Boolean} enable 是否允许激活开关
   * @param {Object} cfg 激活的配置项
   * @return {Geom}    返回 geom 自身
   */
  active(enable, cfg) {
    if (enable === false) {
      this.set('allowActive', false);
    } else if (Util.isObject(enable) && enable.fill) {
      this.set('allowActive', true);
      if (enable.fill) enable.fill = ColorUtil.color2RGBA(enable.fill);
      this.set('activedOptions', enable);
    } else {
      this.set('allowActive', true);
      this.set('activedOptions', cfg || { fill: ColorUtil.color2RGBA(Global.activeColor) });
    }
    return this;
  }

  style(field, cfg) {
    const colorItem = [ 'fill', 'stroke', 'color', 'baseColor', 'brightColor', 'windowColor' ];
    let styleOptions = this.get('styleOptions');
    if (!styleOptions) {
      styleOptions = {};
      this.set('styleOptions', styleOptions);
    }
    if (Util.isObject(field)) {
      cfg = field;
      field = null;
    }
    let fields;
    if (field) {
      fields = parseFields(field);
    }
    styleOptions.fields = fields;
    Util.assign(styleOptions, cfg);
    for (const item in cfg) {
      if (colorItem.indexOf(item) !== -1 && styleOptions[item] !== 'none') {
        styleOptions[item] = ColorUtil.color2RGBA(styleOptions[item]);
      }
    }
    this.set('styleOptions', styleOptions);
    return this;
  }

  filter(field, values) {
    this._needUpdateFilter = true;
    this._createAttrOption('filter', field, values, true);
    return this;
  }

  animate(field, cfg) {
    let animateOptions = this.get('animateOptions');
    if (!animateOptions) {
      animateOptions = {};
      this.set('animateOptions', animateOptions);
    }
    if (Util.isObject(field)) {
      cfg = field;
      field = null;
    }
    let fields;
    if (field) {
      fields = parseFields(field);
    }
    animateOptions.fields = fields;
    Util.assign(animateOptions, cfg);
    this.set('animateOptions', animateOptions);
    return this;
  }
  texture() {

  }
  fitBounds() {
    const extent = this.layerSource.data.extent;
    this.scene.fitBounds(extent);
  }
  hide() {
    this._visible(false);
    return this;
  }
  show() {
    this._visible(true);
    return this;
  }
  _createScale(field) {
    // TODO scale更新
    const scales = this.get('scales');
    let scale = scales[field];
    if (!scale) {
      scale = this.createScale(field);
      scales[field] = scale;
    }
    return scale;
  }
  _setAttrOptions(attrName, attrCfg) {
    const options = this.get('attrOptions');

    if (attrName === 'size' && this._zoomScale) {
      attrCfg.zoom = this.map.getZoom();
    }
    options[attrName] = attrCfg;
  }
  _createAttrOption(attrName, field, cfg, defaultValues) {
    const attrCfg = {};
    attrCfg.field = field;
    if (cfg) {
      if (Util.isFunction(cfg)) {
        attrCfg.callback = cfg;
      } else {
        attrCfg.values = cfg;
      }
    } else if (attrName !== 'color') {
      attrCfg.values = defaultValues;
    }
    this._setAttrOptions(attrName, attrCfg);
  }
  _initControllers() {
    const scales = this.get('scaleOptions');
    const scaleController = new Controller.Scale({
      defs: {
        ...scales
      }
    });
    this.set('scaleController', scaleController);
  }

  createScale(field) {
    const data = this.layerSource.data.dataArray;
    const scales = this.get('scales');
    let scale = scales[field];
    const scaleController = this.get('scaleController');
    if (!scale) {
      scale = scaleController.createScale(field, data);
      scales[field] = scale;
    }
    return scale;
  }
  // 初始化图层
  init() {
    this._initControllers();
    this._initAttrs();
    this._scaleByZoom();
    this._mapping();

    const activeHander = this._addActiveFeature.bind(this);
    const resetHander = this._resetStyle.bind(this);
    if (this.get('allowActive')) {

      this.on('mousemove', activeHander);
      this.on('mouseleave', resetHander);

    } else {
      this.off('mousemove', activeHander);
      this.off('mouseleave', resetHander);
    }
  }

  setActive(id, color) {
    this._activeIds = id;
    this.layerMesh.material.setUniformsValue('u_activeId', id);
    if (!Array.isArray(color)) {
      color = ColorUtil.color2RGBA(color);
    }
    this.layerMesh.material.setUniformsValue('u_activeColor', color);
  }

  _addActiveFeature(e) {
    const { featureId } = e;
    this._activeIds = featureId;
    this.layerMesh.material.setUniformsValue('u_activeId', featureId);
  }


  _initAttrs() {
    const attrOptions = this.get('attrOptions');
    for (const type in attrOptions) {
      if (attrOptions.hasOwnProperty(type)) {
        this._updateAttr(type);
      }
    }
  }

  _updateAttr(type) {
    const self = this;
    const attrs = this.get('attrs');
    const attrOptions = this.get('attrOptions');
    const option = attrOptions[type];
    option.neadUpdate = true;
    const className = Util.upperFirst(type);
    const fields = parseFields(option.field);
    const scales = [];
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      const scale = self._createScale(field);

      if (type === 'color' && Util.isNil(option.values)) { // 设置 color 的默认色值
        option.values = Global.colors;
      }
      scales.push(scale);
    }
    option.scales = scales;
    const attr = new Attr[className](option);
    attrs[type] = attr;
  }
  _updateSize(zoom) {
    const sizeOption = this.get('attrOptions').size;
    const fields = parseFields(sizeOption.field);
    const data = this.layerSource.data.dataArray;
    if (!this.zoomSizeCache) this.zoomSizeCache = {};
    if (!this.zoomSizeCache[zoom]) {
      this.zoomSizeCache[zoom] = [];
      for (let i = 0; i < data.length; i++) {
        const params = fields.map(field => data[i][field]);
        const indexZoom = fields.indexOf('zoom');
        indexZoom !== -1 ? params[indexZoom] = zoom : null;
        this.zoomSizeCache[zoom].push(sizeOption.callback(...params));

      }
    }
    this.emit('sizeUpdated', this.zoomSizeCache[zoom]);
  }

  _mapping() {
    const self = this;
    const attrs = self.get('attrs');
    const mappedData = [];
    // const data = this.layerSource.propertiesData;
    const data = this.layerSource.data.dataArray;
    for (let i = 0; i < data.length; i++) {
      const record = data[i];
      const newRecord = {};
      newRecord.id = data[i]._id;
      for (const k in attrs) {
        if (attrs.hasOwnProperty(k)) {
          const attr = attrs[k];
          attr.needUpdate = false;
          const names = attr.names;

          const values = self._getAttrValues(attr, record);
          if (names.length > 1) { // position 之类的生成多个字段的属性
            for (let j = 0; j < values.length; j++) {
              const val = values[j];
              const name = names[j];
              newRecord[name] = (Util.isArray(val) && val.length === 1) ? val[0] : val; // 只有一个值时返回第一个属性值
            }
          } else {
            newRecord[names[0]] = values.length === 1 ? values[0] : values;

          }
        }
      }
      newRecord.coordinates = record.coordinates;
      mappedData.push(newRecord);
    }
    this.layerData = mappedData;
  }

  // 更新地图映射
  _updateMaping() {
    const self = this;
    const attrs = self.get('attrs');

    const data = this.layerSource.data.dataArray;
    for (let i = 0; i < data.length; i++) {
      const record = data[i];
      for (const attrName in attrs) {
        if (attrs.hasOwnProperty(attrName) && attrs[attrName].neadUpdate) {
          const attr = attrs[attrName];
          const names = attr.names;
          const values = self._getAttrValues(attr, record);
          if (names.length > 1) { // position 之类的生成多个字段的属性
            for (let j = 0; j < values.length; j++) {
              const val = values[j];
              const name = names[j];
              this.layerData[i][name] = (Util.isArray(val) && val.length === 1) ? val[0] : val; // 只有一个值时返回第一个属性值
            }
          } else {
            this.layerData[i][names[0]] = values.length === 1 ? values[0] : values;

          }
          attr.neadUpdate = true;
        }
      }
    }
  }

  // 获取属性映射的值
  _getAttrValues(attr, record) {
    const scales = attr.scales;
    const params = [];
    for (let i = 0; i < scales.length; i++) {
      const scale = scales[i];
      const field = scale.field;
      if (scale.type === 'identity') {
        params.push(scale.value);
      } else {
        params.push(record[field]);
      }
    }
    const indexZoom = params.indexOf('zoom');
    indexZoom !== -1 ? params[indexZoom] = attr.zoom : null;
    const values = attr.mapping(...params);
    return values;
  }

  // temp
  _getDataType(data) {
    if (data.hasOwnProperty('type')) {
      const type = data.type;
      if (type === 'FeatureCollection') {
        return 'geojson';
      }
    }
    return 'basic';
  }
  _scaleByZoom() {
    if (this._zoomScale) {
      this.map.on('zoomend', () => {
        const zoom = this.map.getZoom();
        this._updateSize(Math.floor(zoom));
      });
    }
  }
  // on(type, callback) {

  //   this._addPickingEvents();
  //   super.on(type, callback);
  // }
  getPickingId() {
    return this.scene._engine._picking.getNextId();
  }
  addToPicking(object) {
    this.scene._engine._picking.add(object);
  }
  removeFromPicking(object) {
    this.scene._engine._picking.remove(object);
  }
  _addPickMesh(mesh) {
    this._pickingMesh = new THREE.Object3D();
    this._pickingMesh.name = this.layerId;
    // this._visibleWithZoom();
    // this.scene.on('zoomchange', () => {
    //   this._visibleWithZoom();
    // });
    this.addToPicking(this._pickingMesh);
    const pickmaterial = mesh.material.clone();

    pickmaterial.fragmentShader = pickingFragmentShader;
    // const pickmaterial = new PickingMaterial({
    //   u_zoom: this.scene.getZoom(),
    //   vs: mesh.material.
    // });

    const pickingMesh = new THREE[mesh.type](mesh.geometry, pickmaterial);
    pickingMesh.name = this.layerId;
    pickmaterial.setDefinesvalue(this.type, true);
    pickingMesh.onBeforeRender = () => {
      const zoom = this.scene.getZoom();
      pickingMesh.material.setUniformsValue('u_zoom', zoom);
    };
    this._pickingMesh.add(pickingMesh);

  }
  _setPickingId() {
    this._pickingId = this.getPickingId();
  }
  _initEvents() {
    this.scene.on('pick-' + this.layerId, e => {
      let { featureId, point2d, type } = e;
      if (featureId < 0 && this._activeIds !== null) {
        type = 'mouseleave';
        // featureId = this._activeIds;
      }
      const feature = this.layerSource.getSelectFeature(featureId);
      const lnglat = this.scene.containerToLngLat(point2d);
      const style = this.layerData[featureId - 1];
      const target = {
        featureId,
        feature,
        style,
        pixel: point2d,
        type,
        lnglat: { lng: lnglat.lng, lat: lnglat.lat }
      };
      if (featureId >= 0 || this._activeIds !== null) { // 拾取到元素，或者离开元素
        this.emit(type, target);
      }

    });
  }
  /**
   * 更新active操作
   * @param {*} featureStyleId 需要更新的要素Id
   * @param {*} style  更新的要素样式
   */
  updateStyle(featureStyleId, style) {
    if (this._activeIds) {
      this._resetStyle();
    }
    this._activeIds = featureStyleId;
    const pickingId = this.layerMesh.geometry.attributes.pickingId.array;
    const color = style.color;
    const colorAttr = this.layerMesh.geometry.attributes.a_color;
    const firstId = pickingId.indexOf(featureStyleId[0]);
    for (let i = firstId; i < pickingId.length; i++) {
      if (pickingId[i] === featureStyleId[0]) {
        colorAttr.array[i * 4 + 0] = color[0];
        colorAttr.array[i * 4 + 1] = color[1];
        colorAttr.array[i * 4 + 2] = color[2];
        colorAttr.array[i * 4 + 3] = color[3];
      } else {
        break;
      }
    }
    colorAttr.needsUpdate = true;
    return;
  }

  _updateColor() {

    this._updateMaping();

  }
  /**
   *  用于过滤数据
   * @param {*} object  需要过滤的mesh
   */
  _updateFilter(object) {
    this._updateMaping();
    const filterData = this.layerData;
    this._activeIds = null; // 清空选中元素
    const colorAttr = object.geometry.attributes.a_color;
    const pickAttr = object.geometry.attributes.pickingId;
    pickAttr.array.forEach((id, index) => {
      id = Math.abs(id);
      const color = [ ...this.layerData[id - 1].color ];
      id = Math.abs(id);
      const item = filterData[id - 1];
      if (item.hasOwnProperty('filter') && item.filter === false) {
        colorAttr.array[index * 4 + 0] = 0;
        colorAttr.array[index * 4 + 1] = 0;
        colorAttr.array[index * 4 + 2] = 0;
        colorAttr.array[index * 4 + 3] = 0;
        pickAttr.array[index] = -id; // 通过Id数据过滤 id<0 不显示
      } else {
        colorAttr.array[index * 4 + 0] = color[0];
        colorAttr.array[index * 4 + 1] = color[1];
        colorAttr.array[index * 4 + 2] = color[2];
        colorAttr.array[index * 4 + 3] = color[3];
        pickAttr.array[index] = id;
      }
    });
    colorAttr.needsUpdate = true;
    pickAttr.needsUpdate = true;
  }
  _visibleWithZoom() {
    const zoom = this.scene.getZoom();
    const minZoom = this.get('minZoom');
    const maxZoom = this.get('maxZoom');
    // z-fighting
    let offset = 0;
    if (this.type === 'point') {
      offset = 5;
    } else if (this.type === 'polyline') {
      offset = 2;
    }
    this._object3D.position.z = offset * Math.pow(2, 20 - zoom);
    if (zoom < minZoom || zoom > maxZoom) {
      this._object3D.visible = false;
    } else if (this.get('visible')) {
      this._object3D.visible = true;
    }
  }
  /**
   * 重置高亮要素
   */
  _resetStyle() {
    this._activeIds = null;
    this.layerMesh.material.setUniformsValue('u_activeId', 0);
  }
  /**
   * 销毁Layer对象
   */
  destroy() {
    this.removeAllListeners();
    if (this._object3D && this._object3D.children) {
      let child;
      for (let i = 0; i < this._object3D.children.length; i++) {
        child = this._object3D.children[i];
        if (!child) {
          continue;
        }
        this.remove(child);
        if (child.geometry) {
          // child.geometry.dispose();
          child.geometry = null;
        }
        if (child.material) {
          if (child.material.map) {
            child.material.map.dispose();
            child.material.map = null;
          }

          child.material.dispose();
          child.material = null;
        }
        child = null;
      }
    }
    this._object3D = null;
    this.scene._engine._scene.remove(this._object3D);
    this.scene._engine._picking.remove(this._pickingMesh);
    this.scene.off('zoomchange', this._zoomchangeHander);
    this.destroyed = true;
  }

  /**
   * 获取图例配置项
   * @param {*} field 字段
   * @param {*} type 图例类型 color, size
   * @return {*} 图例配置项
   */
  getLegendCfg(field, type = 'color') {
    // todo heatmap
    if (this.type === 'heatmap' && this.shapeType === 'heatmap') {
      return this.get('styleOptions').rampColors;
    }
    const scales = this.get('scales');
    const scale = scales[field];
    const colorAttrs = this.get('attrs')[type];
    const lengendCfg = {};
    if (scale) {
      const ticks = scale.ticks;
      lengendCfg.value = ticks;
      lengendCfg.type = scale.type;
      const values = ticks.map(value => {
        const v = this._getAttrValues(colorAttrs, { [field]: value });
        return type === 'color' ? ColorUtil.colorArray2RGBA(v) : v;
      });
      lengendCfg[type] = values;
    }
    return lengendCfg;
  }
  preRender() {

  }

  afterRender() {

  }
}

