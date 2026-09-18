// Minimal Leaflet mock sufficient to exercise our app's map logic in Node/jsdom,
// without needing real DOM layout/canvas (which jsdom can't provide for Leaflet).
function makeMockLeaflet(){
  const debug = { tileLayers: [], geoJSONLayers: [], maps: [] };
  function MockLayer(feature){
    return {
      feature,
      _talhaoIdx: null,
      _style: null,
      _tooltip: null,
      _handlers: {},
      setStyle(s){ this._style = s; },
      getBounds(){ return { isValid: () => true, _b:true }; },
      getLatLng(){ return feature && feature.geometry && feature.geometry.type==='Point' ? {lat:0,lng:0} : undefined; },
      on(evt, cb){ this._handlers[evt] = cb; },
      fire(evt){ if(this._handlers[evt]) this._handlers[evt](); },
      bindTooltip(content, opts){ this._tooltip = content; this._tooltipOpts = opts || {}; },
      getTooltip(){ return this._tooltip==null ? null : {conteudo:this._tooltip, opcoes:this._tooltipOpts}; },
      setTooltipContent(content){ this._tooltip = content; },
      unbindTooltip(){ this._tooltip = null; this._tooltipOpts = null; },
      openTooltip(){ this._tooltipOpen = true; },
    };
  }
  function MockTileLayer(url, opts){
    const handlers={};
    let onMap=null;
    return {
      _url:url, _opts:opts,
      on(evt,cb){ handlers[evt]=cb; return this; },
      fire(evt){ if(handlers[evt]) handlers[evt](); },
      addTo(map){ onMap=map; map.addLayerRef(this); return this; },
      remove(){ if(onMap) onMap.removeLayer(this); onMap=null; return this; },
    };
  }
  const L = {
    __debug: debug,
    map(el, opts){
      const layers = [];
      const handlers = {};
      const m = {
        _layers: layers,
        // Contadores que os testes usam pra provar que o mapa não fica se
        // reenquadrando sozinho (era o que fazia o mapa "ir diminuindo").
        _fitBounds: 0,
        _invalidateSize: 0,
        _centro: {lat:-15.79, lng:-47.93},
        _zoom: 4,
        setView(latlng, zoom){
          if(Array.isArray(latlng)) this._centro = {lat:latlng[0], lng:latlng[1]};
          else if(latlng && latlng.lat!=null) this._centro = {lat:latlng.lat, lng:latlng.lng};
          if(zoom!=null) this._zoom = zoom;
          return this;
        },
        getCenter(){ return this._centro; },
        on(evt, cb){ handlers[evt] = cb; return this; },
        fire(evt){ if(handlers[evt]) handlers[evt](); },
        invalidateSize(){ this._invalidateSize++; },
        fitBounds(){ this._fitBounds++; this._zoom = 15; },
        removeLayer(layer){ const i=layers.indexOf(layer); if(i>=0) layers.splice(i,1); },
        hasLayer(layer){ return layers.indexOf(layer)>=0; },
        getZoom(){ return this._zoom; },
        addLayerRef(l){ if(layers.indexOf(l)<0) layers.push(l); },
      };
      debug.maps.push(m);
      return m;
    },
    tileLayer(url, opts){ const t=new MockTileLayer(url, opts); debug.tileLayers.push(t); return t; },
    control: {
      layers(obj){ return { addTo(map){ return this; } }; }
    },
    circleMarker(latlng, opts){ return MockLayer({geometry:{type:'Point'}}); },
    geoJSON(gj, opts){
      const layers = gj.features.map(f=>{
        let layer;
        if(f.geometry && f.geometry.type==='Point' && opts.pointToLayer){
          layer = opts.pointToLayer(f, {lat:0,lng:0});
        } else {
          layer = MockLayer(f);
        }
        if(opts.style) layer.setStyle(opts.style(f));
        if(opts.onEachFeature) opts.onEachFeature(f, layer);
        return layer;
      });
      const group = {
        _mockLayers: layers,
        addTo(map){ map.addLayerRef(this); return this; },
        eachLayer(cb){ layers.forEach(cb); },
        getBounds(){ return { isValid: () => layers.length>0 }; },
      };
      debug.geoJSONLayers.push(group);
      return group;
    }
  };
  return L;
}
module.exports = { makeMockLeaflet };
