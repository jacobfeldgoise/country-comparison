import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const clampNumber = (value, min, max) => Math.min(Math.max(value, min), max);

const identityConstrain = (position) => position;

export const useBoundedZoomPan = ({
  center = [0, 0],
  zoom = 1,
  minZoom = 1,
  maxZoom = 5,
  zoomSensitivity = 0.025,
  onZoomStart,
  onZoomEnd,
  onMoveStart,
  onMove,
  onMoveEnd,
  disablePanning = false,
  disableZooming = false,
  width = 0,
  height = 0,
  projection,
  constrain = identityConstrain,
}) => {
  const clampPosition = useCallback(
    (pos) => {
      const baseZoom = clampNumber(pos.zoom ?? zoom, minZoom, maxZoom);
      const base = {
        x: pos.x ?? 0,
        y: pos.y ?? 0,
        zoom: baseZoom,
      };

      try {
        const constrained = constrain({ ...base });
        if (!constrained) return base;
        return {
          x: Number.isFinite(constrained.x) ? constrained.x : base.x,
          y: Number.isFinite(constrained.y) ? constrained.y : base.y,
          zoom: clampNumber(constrained.zoom ?? base.zoom, minZoom, maxZoom),
        };
      } catch {
        return base;
      }
    },
    [constrain, maxZoom, minZoom, zoom]
  );

  const projectCenter = useCallback(
    (coordinates, currentZoom) => {
      if (!projection) {
        return {
          x: width / 2,
          y: height / 2,
        };
      }

      try {
        const projected = projection(coordinates);
        if (!Array.isArray(projected) || projected.length < 2) {
          throw new Error("invalid projection");
        }
        const [px, py] = projected;
        if (!Number.isFinite(px) || !Number.isFinite(py)) {
          throw new Error("non-finite projection");
        }
        return {
          x: width / 2 - px * currentZoom,
          y: height / 2 - py * currentZoom,
        };
      } catch {
        return {
          x: width / 2,
          y: height / 2,
        };
      }
    },
    [projection, width, height]
  );

  const [position, setPosition] = useState(() => {
    const projected = projectCenter(center, zoom);
    const clamped = clampPosition({ ...projected, zoom });
    return {
      x: clamped.x,
      y: clamped.y,
      last: [clamped.x, clamped.y],
      zoom: clamped.zoom,
      dragging: false,
      zooming: false,
    };
  });

  const elRef = useRef(null);
  const point = useRef(null);
  const wheelTimer = useRef(null);
  const isPointerDown = useRef(false);
  const pointerOrigin = useRef(null);

  const getPointFromEvent = useCallback((event) => {
    const svg = elRef.current?.closest("svg");
    if (!svg) {
      return { x: 0, y: 0 };
    }

    if (!point.current) {
      point.current = svg.createSVGPoint();
    }

    if (event.targetTouches && event.targetTouches[0]) {
      point.current.x = event.targetTouches[0].clientX;
      point.current.y = event.targetTouches[0].clientY;
    } else {
      point.current.x = event.clientX;
      point.current.y = event.clientY;
    }

    try {
      const invertedMatrix = svg.getScreenCTM().inverse();
      return point.current.matrixTransform(invertedMatrix);
    } catch {
      return { x: 0, y: 0 };
    }
  }, []);

  const handlePointerDown = useCallback(
    (event) => {
      if (disablePanning) return;
      const svg = elRef.current?.closest("svg");
      if (!svg) return;

      isPointerDown.current = true;
      pointerOrigin.current = getPointFromEvent(event);

      setPosition((current) => {
        const next = { ...current, dragging: true };
        if (onMoveStart) onMoveStart(event, next);
        return next;
      });
    },
    [disablePanning, getPointFromEvent, onMoveStart]
  );

  const handlePointerMove = useCallback(
    (event) => {
      if (!isPointerDown.current) return;
      event.preventDefault();
      const pointerPosition = getPointFromEvent(event);

      setPosition((current) => {
        if (!pointerOrigin.current) return current;
        const raw = {
          ...current,
          x: current.last[0] + (pointerPosition.x - pointerOrigin.current.x),
          y: current.last[1] + (pointerPosition.y - pointerOrigin.current.y),
          dragging: true,
        };
        const clamped = clampPosition(raw);
        const next = {
          ...current,
          x: clamped.x,
          y: clamped.y,
          zoom: clamped.zoom,
          dragging: true,
        };
        if (onMove) onMove(event, next);
        return next;
      });
    },
    [clampPosition, getPointFromEvent, onMove]
  );

  const handlePointerUp = useCallback(
    (event) => {
      if (!isPointerDown.current) return;
      isPointerDown.current = false;

      setPosition((current) => {
        const clamped = clampPosition(current);
        const next = {
          ...current,
          x: clamped.x,
          y: clamped.y,
          zoom: clamped.zoom,
          last: [clamped.x, clamped.y],
          dragging: false,
        };
        if (onMoveEnd) onMoveEnd(event, next);
        return next;
      });
    },
    [clampPosition, onMoveEnd]
  );

  const handleWheel = useCallback(
    (event) => {
      if (!event.ctrlKey || disableZooming) return;
      event.preventDefault();

      const speed = event.deltaY * zoomSensitivity;

      setPosition((current) => {
        const newZoom = clampNumber(current.zoom - speed, minZoom, maxZoom);
        const pointerPosition = getPointFromEvent(event);

        const rawX = (current.x - pointerPosition.x) * (newZoom / current.zoom) + pointerPosition.x;
        const rawY = (current.y - pointerPosition.y) * (newZoom / current.zoom) + pointerPosition.y;

        let next = {
          ...current,
          x: rawX,
          y: rawY,
          zoom: newZoom,
          zooming: true,
          last: [rawX, rawY],
        };

        next = { ...next, ...clampPosition(next) };
        next.last = [next.x, next.y];

        window.clearTimeout(wheelTimer.current);
        wheelTimer.current = window.setTimeout(() => {
          setPosition((finalState) => ({ ...finalState, zooming: false }));
          if (onZoomEnd) onZoomEnd(event, next);
        }, 66);

        if (onZoomStart) onZoomStart(event, next);

        return next;
      });
    },
    [clampPosition, disableZooming, getPointFromEvent, maxZoom, minZoom, onZoomEnd, onZoomStart, zoomSensitivity]
  );

  useLayoutEffect(() => {
    const svg = elRef.current?.closest("svg");
    if (!svg) return undefined;

    const down = (event) => handlePointerDown(event);
    const move = (event) => handlePointerMove(event);
    const up = (event) => handlePointerUp(event);

    svg.addEventListener("wheel", handleWheel, { passive: false });

    if (window.PointerEvent) {
      svg.addEventListener("pointerdown", down);
      svg.addEventListener("pointermove", move, { passive: false });
      svg.addEventListener("pointerup", up);
      svg.addEventListener("pointerleave", up);
    } else {
      svg.addEventListener("mousedown", down);
      svg.addEventListener("mousemove", move);
      svg.addEventListener("mouseup", up);
      svg.addEventListener("mouseleave", up);
      svg.addEventListener("touchstart", down);
      svg.addEventListener("touchmove", move, { passive: false });
      svg.addEventListener("touchend", up);
    }

    return () => {
      svg.removeEventListener("wheel", handleWheel);

      if (window.PointerEvent) {
        svg.removeEventListener("pointerdown", down);
        svg.removeEventListener("pointermove", move);
        svg.removeEventListener("pointerup", up);
        svg.removeEventListener("pointerleave", up);
      } else {
        svg.removeEventListener("mousedown", down);
        svg.removeEventListener("mousemove", move);
        svg.removeEventListener("mouseup", up);
        svg.removeEventListener("mouseleave", up);
        svg.removeEventListener("touchstart", down);
        svg.removeEventListener("touchmove", move);
        svg.removeEventListener("touchend", up);
      }
    };
  }, [handlePointerDown, handlePointerMove, handlePointerUp, handleWheel]);

  useEffect(() => {
    setPosition((current) => {
      const updated = clampPosition({ ...current, zoom });
      return {
        ...current,
        x: updated.x,
        y: updated.y,
        zoom: updated.zoom,
        last: [updated.x, updated.y],
      };
    });
  }, [clampPosition, zoom]);

  useEffect(() => {
    setPosition((current) => {
      const projected = projectCenter(center, current.zoom);
      const updated = clampPosition({ ...current, ...projected });
      return {
        ...current,
        x: updated.x,
        y: updated.y,
        zoom: updated.zoom,
        last: [updated.x, updated.y],
      };
    });
  }, [center, clampPosition, projectCenter]);

  useEffect(() => {
    setPosition((current) => {
      const updated = clampPosition(current);
      return {
        ...current,
        x: updated.x,
        y: updated.y,
        zoom: updated.zoom,
        last: [updated.x, updated.y],
      };
    });
  }, [clampPosition]);

  useEffect(() => () => {
    if (wheelTimer.current) {
      window.clearTimeout(wheelTimer.current);
    }
  }, []);

  return {
    elRef,
    position,
    transformString: `translate(${position.x} ${position.y}) scale(${position.zoom})`,
  };
};

export const BoundedZoomableGroup = ({
  children,
  render,
  className = "",
  width,
  height,
  projection,
  constrain,
  ...rest
}) => {
  const { elRef, position, transformString } = useBoundedZoomPan({
    width,
    height,
    projection,
    constrain,
    ...rest,
  });

  return (
    <g ref={elRef} className={`rsm-zoomable-group ${className}`}>
      {render ? render(position) : <g transform={transformString}>{children}</g>}
    </g>
  );
};

