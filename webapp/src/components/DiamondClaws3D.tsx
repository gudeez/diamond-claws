'use client';

import { useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useTexture, Environment } from '@react-three/drei';
import * as THREE from 'three';

function LogoPlane() {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const targetRotation = useRef({ x: 0, y: 0 });
  const { viewport } = useThree();

  const texture = useTexture('/diamondclaw2-removebg-preview.png');
  texture.colorSpace = THREE.SRGBColorSpace;

  // Track mouse position and set target rotation
  useFrame((state) => {
    if (!meshRef.current) return;

    const { pointer } = state;
    targetRotation.current.y = pointer.x * 0.4;
    targetRotation.current.x = -pointer.y * 0.3;

    // Smooth lerp to target
    meshRef.current.rotation.y = THREE.MathUtils.lerp(
      meshRef.current.rotation.y,
      targetRotation.current.y,
      0.05
    );
    meshRef.current.rotation.x = THREE.MathUtils.lerp(
      meshRef.current.rotation.x,
      targetRotation.current.x,
      0.05
    );

    // Subtle floating animation
    meshRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.8) * 0.08;

    // Scale pulse on hover
    const targetScale = hovered ? 1.08 : 1;
    meshRef.current.scale.x = THREE.MathUtils.lerp(meshRef.current.scale.x, targetScale, 0.1);
    meshRef.current.scale.y = THREE.MathUtils.lerp(meshRef.current.scale.y, targetScale, 0.1);
  });

  // Calculate aspect ratio from texture
  const aspect = texture.image
    ? texture.image.width / texture.image.height
    : 1;
  const planeHeight = Math.min(viewport.height * 1.1, 7);
  const planeWidth = planeHeight * aspect;

  return (
    <mesh
      ref={meshRef}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      <planeGeometry args={[planeWidth, planeHeight]} />
      <meshPhysicalMaterial
        map={texture}
        transparent
        alphaTest={0.01}
        roughness={0.15}
        metalness={0.9}
        clearcoat={1}
        clearcoatRoughness={0.05}
        reflectivity={1}
        envMapIntensity={1.5}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

export default function DiamondClaws3D() {
  return (
    <Canvas
      camera={{ position: [0, 0, 4], fov: 50 }}
      style={{ width: '100%', height: '100%' }}
      gl={{ alpha: true, antialias: true }}
    >
      <ambientLight intensity={0.3} />
      <directionalLight position={[5, 5, 5]} intensity={1.5} />
      <directionalLight position={[-5, -2, 3]} intensity={0.5} color="#facc15" />
      <spotLight
        position={[0, 5, 3]}
        intensity={2}
        angle={0.5}
        penumbra={0.5}
        color="#ffffff"
      />
      <pointLight position={[-3, 0, 2]} intensity={0.8} color="#facc15" />
      <Environment preset="city" />
      <LogoPlane />
    </Canvas>
  );
}
